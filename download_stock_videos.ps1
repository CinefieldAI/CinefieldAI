# Marketing Studio Product Videos - Batch Download Script
# Downloads free stock videos from Pexels, Pixabay, or Coverr

param(
    [string]$Source = "pexels",  # "pexels", "pixabay", or "manual"
    [int]$Timeout = 60
)

$outDir = Join-Path (Get-Location) "public\assets\higgsfield\marketing-studio\product"

# Video modes with search queries
$videoModes = @(
    @{file="ugc.mp4"; query="user generated content creator"; desc="UGC"},
    @{file="gadget_saved_me.mp4"; query="gadget tech review"; desc="Gadget Saved Me"},
    @{file="giant_figure.mp4"; query="giant oversized product"; desc="Giant Figure"},
    @{file="unboxing_try_on.mp4"; query="unboxing fashion"; desc="Unboxing Try On"},
    @{file="unboxing_asmr.mp4"; query="asmr satisfying unboxing"; desc="Unboxing ASMR"},
    @{file="try_on_sneakers.mp4"; query="sneaker shoes try on"; desc="Try On Sneakers"},
    @{file="couple_sharing_home.mp4"; query="couple home lifestyle"; desc="Couple Sharing"},
    @{file="selfie_testimonial.mp4"; query="person talking camera testimonial"; desc="Selfie Testimonial"},
    @{file="direct_to_camera.mp4"; query="creator vlogger talking"; desc="Direct to Camera"},
    @{file="secret_hack_reveal.mp4"; query="life hack product"; desc="Secret Hack Reveal"},
    @{file="crush_test.mp4"; query="durability test satisfaction"; desc="Crush Test"},
    @{file="hyper_motion.mp4"; query="product motion fast"; desc="Hyper Motion"},
    @{file="camera_pov.mp4"; query="point of view pov"; desc="Camera POV"},
    @{file="classic_meets_modern.mp4"; query="luxury modern product"; desc="Classic Meets Modern"},
    @{file="mess_to_fresh.mp4"; query="cleaning transformation"; desc="Mess to Fresh"},
    @{file="mystery_box.mp4"; query="box opening surprise"; desc="Mystery Box"},
    @{file="reboxing.mp4"; query="packaging product box"; desc="Reboxing"},
    @{file="tv_spot.mp4"; query="commercial advertising"; desc="TV Spot"},
    @{file="addiction.mp4"; query="product lifestyle"; desc="Addiction"},
    @{file="before_after.mp4"; query="transformation before after"; desc="Before & After"},
    @{file="tutorial.mp4"; query="how to step by step"; desc="Tutorial"},
    @{file="unboxing.mp4"; query="product unboxing high quality"; desc="Unboxing"},
    @{file="ugc_virtual_try_on.mp4"; query="virtual try on fashion"; desc="UGC Virtual Try On"},
    @{file="pro_virtual_try_on.mp4"; query="professional fashion try on"; desc="Pro Virtual Try On"},
    @{file="wild_card.mp4"; query="creative experimental product"; desc="Wild Card"},
    @{file="product_review.mp4"; query="product review authentic"; desc="Product Review"}
)

Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Marketing Studio Product - Stock Video Downloader" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "📁 Output Directory: $outDir" -ForegroundColor Yellow
Write-Host "📊 Total Videos: $($videoModes.Count)" -ForegroundColor Yellow
Write-Host ""

if ($Source -eq "manual") {
    Write-Host "MANUAL DOWNLOAD INSTRUCTIONS:" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""

    foreach ($mode in $videoModes) {
        Write-Host "[$($videoModes.IndexOf($mode) + 1)/26] $($mode.desc)" -ForegroundColor Cyan
        Write-Host "  File: $($mode.file)" -ForegroundColor White
        Write-Host "  Search: $($mode.query)" -ForegroundColor Gray
        Write-Host "  1️⃣  Go to: https://www.pexels.com/search/videos/" -ForegroundColor Yellow
        Write-Host "  2️⃣  Search: '$($mode.query)'" -ForegroundColor Yellow
        Write-Host "  3️⃣  Download first matching MP4 video" -ForegroundColor Yellow
        Write-Host "  4️⃣  Save as: $outDir\$($mode.file)" -ForegroundColor Yellow
        Write-Host ""
    }

    Write-Host "=" * 60
    Write-Host "Alternative Free Stock Video Sites:" -ForegroundColor Green
    Write-Host "  • Pexels Videos: https://www.pexels.com/videos/" -ForegroundColor Gray
    Write-Host "  • Pixabay Videos: https://pixabay.com/videos/" -ForegroundColor Gray
    Write-Host "  • Coverr: https://www.coverr.co/" -ForegroundColor Gray
    Write-Host "  • Vecteezy: https://www.vecteezy.com/free-videos" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Once downloaded, run the page at: http://localhost:3000/marketing-studio/product" -ForegroundColor Green

} else {
    Write-Host "RECOMMENDED WORKFLOW:" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Option 1: Manual Download (Recommended for Quality Control)" -ForegroundColor Cyan
    Write-Host "  Run: powershell .\download_stock_videos.ps1 -Source manual" -ForegroundColor Gray
    Write-Host ""

    Write-Host "Option 2: Automated with Pexels API (Free, No Key)" -ForegroundColor Cyan
    Write-Host "  Requires: curl or wget installed" -ForegroundColor Gray
    Write-Host "  Status: Coming soon" -ForegroundColor Yellow
    Write-Host ""

    Write-Host "Option 3: Use Coverr Links Directly" -ForegroundColor Cyan
    Write-Host "  Status: Some free videos available" -ForegroundColor Yellow
    Write-Host ""

    Write-Host "QUICK START:" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "1. Visit: https://www.pexels.com/videos/" -ForegroundColor Yellow
    Write-Host "2. Search for each video using the queries provided" -ForegroundColor Yellow
    Write-Host "3. Download the first matching MP4" -ForegroundColor Yellow
    Write-Host "4. Save to: $outDir\" -ForegroundColor Yellow
    Write-Host "5. Use exact filenames from the list above" -ForegroundColor Yellow
    Write-Host ""

    Write-Host "📝 NOTES:" -ForegroundColor Cyan
    Write-Host "  • All stock videos are FREE to use" -ForegroundColor Gray
    Write-Host "  • No attribution required for Pexels/Pixabay" -ForegroundColor Gray
    Write-Host "  • Recommended: 3-10 seconds per video" -ForegroundColor Gray
    Write-Host "  • File size: Aim for 500KB - 5MB per video" -ForegroundColor Gray
    Write-Host ""
}

# Show current status
Write-Host "CURRENT STATUS:" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan

if (Test-Path $outDir) {
    $existingVideos = @(Get-ChildItem -Path $outDir -Filter "*.mp4" | Where-Object { $_.Length -gt 0 })
    $emptyFiles = @(Get-ChildItem -Path $outDir -Filter "*.mp4" | Where-Object { $_.Length -eq 0 })

    Write-Host "✅ Videos with content: $($existingVideos.Count)" -ForegroundColor Green
    Write-Host "⚪ Empty placeholders: $($emptyFiles.Count)" -ForegroundColor Yellow
    Write-Host "📊 Total: $($existingVideos.Count + $emptyFiles.Count)/26" -ForegroundColor Cyan

    if ($existingVideos.Count -gt 0) {
        Write-Host ""
        Write-Host "Already downloaded:" -ForegroundColor Green
        foreach ($video in $existingVideos) {
            $sizeKB = $video.Length / 1KB
            Write-Host "  [OK] $($video.Name) ($([math]::Round($sizeKB, 1))KB)" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[ERROR] Directory not found: $outDir" -ForegroundColor Red
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
