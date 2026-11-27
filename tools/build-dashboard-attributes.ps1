param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.Encoding]::UTF8
$invariant = [System.Globalization.CultureInfo]::InvariantCulture

function Read-SafeDbfRows {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [Parameter(Mandatory)] [string[]]$Fields,
    [Parameter(Mandatory)] [string[]]$GeometrySignatures
  )

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $recordCount = [BitConverter]::ToUInt32($bytes, 4)
  if ($GeometrySignatures.Count -ne $recordCount) { throw "El SHP y DBF no tienen el mismo número de registros: $Path" }
  $headerLength = [BitConverter]::ToUInt16($bytes, 8)
  $recordLength = [BitConverter]::ToUInt16($bytes, 10)
  $descriptors = @{}
  $offset = 1

  for ($position = 32; $position -lt $headerLength -and $bytes[$position] -ne 13; $position += 32) {
    $nameEnd = $position
    while ($nameEnd -lt $position + 11 -and $bytes[$nameEnd] -ne 0) { $nameEnd++ }
    $name = [System.Text.Encoding]::ASCII.GetString($bytes, $position, $nameEnd - $position)
    $length = [int]$bytes[$position + 16]
    $type = [char]$bytes[$position + 11]
    if ($Fields -contains $name) {
      $descriptors[$name] = @{ Offset = $offset; Length = $length; Type = $type }
    }
    $offset += $length
  }

  $missing = @($Fields | Where-Object { -not $descriptors.ContainsKey($_) })
  if ($missing.Count) { throw "Faltan campos requeridos en ${Path}: $($missing -join ', ')" }

  $rows = [System.Collections.Generic.List[object]]::new()
  for ($rowIndex = 0; $rowIndex -lt $recordCount; $rowIndex++) {
    $recordStart = $headerLength + $rowIndex * $recordLength
    if ($bytes[$recordStart] -eq 42) { throw "El DBF contiene registros eliminados y requiere revisar la alineación: $Path" }
    $row = [ordered]@{ sourceId = $rowIndex + 1; geometryHash = $GeometrySignatures[$rowIndex] }
    foreach ($field in $Fields) {
      $descriptor = $descriptors[$field]
      $value = $utf8.GetString($bytes, $recordStart + $descriptor.Offset, $descriptor.Length).Trim()
      if ([string]::IsNullOrWhiteSpace($value)) {
        $row[$field] = $null
      } elseif ($descriptor.Type -in @('N', 'F')) {
        $number = 0.0
        if ([double]::TryParse($value, [System.Globalization.NumberStyles]::Float, $invariant, [ref]$number)) {
          $row[$field] = $number
        } else {
          $row[$field] = $null
        }
      } else {
        $row[$field] = $value
      }
    }
    [void]$rows.Add([pscustomobject]$row)
  }

  return ,$rows.ToArray()
}

function Read-ShapeSignatures {
  param([Parameter(Mandatory)] [string]$Path)

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $signatures = [System.Collections.Generic.List[string]]::new()
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $position = 100
    while ($position + 8 -le $bytes.Length) {
      $contentWords = [int]$bytes[$position + 4] * 16777216 + [int]$bytes[$position + 5] * 65536 + [int]$bytes[$position + 6] * 256 + [int]$bytes[$position + 7]
      $contentStart = $position + 8
      $contentEnd = $contentStart + $contentWords * 2
      if ($contentEnd -gt $bytes.Length) { throw "Registro incompleto en $Path" }
      $shapeType = [BitConverter]::ToInt32($bytes, $contentStart)
      if ($shapeType -in @(5, 15, 25)) {
        $parts = [BitConverter]::ToInt32($bytes, $contentStart + 36)
        $points = [BitConverter]::ToInt32($bytes, $contentStart + 40)
        $signatureStart = $contentStart + 36
        $signatureLength = 8 + $parts * 4 + $points * 16
        if ($parts -lt 1 -or $points -lt 1 -or $signatureStart + $signatureLength -gt $contentEnd) { throw "Geometría poligonal inválida en $Path" }
      } else {
        $signatureStart = $contentStart
        $signatureLength = $contentEnd - $contentStart
      }
      $hash = $hasher.ComputeHash($bytes, $signatureStart, $signatureLength)
      $signatures.Add([BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant())
      $position = $contentEnd
    }
  } finally {
    $hasher.Dispose()
  }
  return ,$signatures.ToArray()
}

$parcelPath = Join-Path $ProjectRoot 'data\Predios_Barrios_Estudio\Predios_Estudio.dbf'
$buildingPath = Join-Path $ProjectRoot 'data\Construcciones_Barrios_Estudio\Construcciones.dbf'
$parcelGeometryPath = Join-Path $ProjectRoot 'data\Predios_Barrios_Estudio\Predios_Estudio.shp'
$buildingGeometryPath = Join-Path $ProjectRoot 'data\Construcciones_Barrios_Estudio\Construcciones.shp'
$parcelFields = @('numero_pre', 'matricula_', 'tipo_predi', 'destinacio', 'Shape_Area', 'riesgo', 'categoria')
$buildingFields = @('cbml', 'id_constru', 'numero_pis', 'Shape_Area', 'riesgo', 'categoria')
$parcelSignatures = Read-ShapeSignatures -Path $parcelGeometryPath
$buildingSignatures = Read-ShapeSignatures -Path $buildingGeometryPath
$parcels = Read-SafeDbfRows -Path $parcelPath -Fields $parcelFields -GeometrySignatures $parcelSignatures
$buildings = Read-SafeDbfRows -Path $buildingPath -Fields $buildingFields -GeometrySignatures $buildingSignatures

$payload = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
  crs = 'EPSG:9377'
  parcels = $parcels
  buildings = $buildings
}
$destination = Join-Path $ProjectRoot 'data\dashboard_attributes.json'
$json = ConvertTo-Json -InputObject $payload -Depth 5 -Compress
[System.IO.File]::WriteAllText($destination, $json, [System.Text.UTF8Encoding]::new($false))

Write-Output "Dashboard safe attributes: $($parcels.Count) predios, $($buildings.Count) construcciones."
Write-Output "Generated: $destination"
