# Beacon Quran Institute LMS - TcpListener Local Web Server (Port 8080)

$port = 8080
$ip = [System.Net.IPAddress]::Parse("127.0.0.1")
$server = New-Object System.Net.Sockets.TcpListener($ip, $port)

Write-Host "==============================================" -ForegroundColor Green
Write-Host "   Beacon Quran Institute LMS Local Server    " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Green
Write-Host "Starting TCP Socket Server on http://127.0.0.1:$port/ ..." -ForegroundColor Yellow

try {
    $server.Start()
    Write-Host "Server is running! Ready for connections on port 8080." -ForegroundColor Green
    
    while ($true) {
        $client = $server.AcceptTcpClient()
        $stream = $client.GetStream()
        
        $buffer = New-Object byte[] 4096
        $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
        $requestText = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $bytesRead)
        
        if ($requestText) {
            $firstLine = $requestText.Split("`n")[0]
            $url = $firstLine.Split(" ")[1]
            if ($url -eq "/" -or $url -eq "") { $url = "/login.html" }
            
            # Clean URL params if any
            $cleanUrl = $url.Split("?")[0]
            $filePath = [System.IO.Path]::Combine($pwd.Path, $cleanUrl.TrimStart('/'))
            
            if (Test-Path $filePath -PathType Leaf) {
                $content = [System.IO.File]::ReadAllBytes($filePath)
                
                $contentType = "text/html; charset=utf-8"
                if ($filePath.EndsWith(".css")) { $contentType = "text/css; charset=utf-8" }
                elseif ($filePath.EndsWith(".js")) { $contentType = "application/javascript; charset=utf-8" }
                elseif ($filePath.EndsWith(".png")) { $contentType = "image/png" }
                elseif ($filePath.EndsWith(".jpg")) { $contentType = "image/jpeg" }
                
                $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($content.Length)`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n`r`n"
                $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                
                $stream.Write($headerBytes, 0, $headerBytes.Length)
                $stream.Write($content, 0, $content.Length)
            } else {
                $err = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nConnection: close`r`n`r`n404 Not Found"
                $errBytes = [System.Text.Encoding]::ASCII.GetBytes($err)
                $stream.Write($errBytes, 0, $errBytes.Length)
            }
        }
        $client.Close()
    }
} catch {
    Write-Host "Server Error: $_" -ForegroundColor Red
} finally {
    $server.Stop()
}
