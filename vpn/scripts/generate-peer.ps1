param(
    [string]$PeerName = 'phone1'
)

Set-Location $PSScriptRoot\..

docker compose exec -T wireguard /app/show-peer $PeerName
