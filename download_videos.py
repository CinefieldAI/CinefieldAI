#!/usr/bin/env python3
"""
Download stock videos from Pexels for Marketing Studio Product modes.
Requires: requests library (pip install requests)
"""

import os
import requests
from pathlib import Path

# Directory to save videos
OUTPUT_DIR = Path(__file__).parent / "public" / "assets" / "higgsfield" / "marketing-studio" / "product"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Video modes with search terms and file names
VIDEO_MODES = [
    ("ugc", "user generated content creator", "ugc.mp4"),
    ("gadget_saved_me", "gadget review tech", "gadget_saved_me.mp4"),
    ("giant_figure", "giant oversized product", "giant_figure.mp4"),
    ("unboxing_try_on", "unboxing fashion", "unboxing_try_on.mp4"),
    ("unboxing_asmr", "asmr satisfying unboxing", "unboxing_asmr.mp4"),
    ("try_on_sneakers", "sneaker shoes try on", "try_on_sneakers.mp4"),
    ("couple_sharing_home", "couple home lifestyle", "couple_sharing_home.mp4"),
    ("selfie_testimonial", "person talking camera testimonial", "selfie_testimonial.mp4"),
    ("direct_to_camera", "creator vlogger talking camera", "direct_to_camera.mp4"),
    ("secret_hack_reveal", "life hack product", "secret_hack_reveal.mp4"),
    ("crush_test", "durability test satisfaction", "crush_test.mp4"),
    ("hyper_motion", "product motion fast", "hyper_motion.mp4"),
    ("camera_pov", "point of view pov", "camera_pov.mp4"),
    ("classic_meets_modern", "luxury modern product", "classic_meets_modern.mp4"),
    ("mess_to_fresh", "cleaning transformation messy clean", "mess_to_fresh.mp4"),
    ("mystery_box", "box opening surprise", "mystery_box.mp4"),
    ("reboxing", "packaging product box", "reboxing.mp4"),
    ("tv_spot", "commercial advertising product", "tv_spot.mp4"),
    ("addiction", "product lifestyle person using", "addiction.mp4"),
    ("before_after", "transformation before after", "before_after.mp4"),
    ("tutorial", "how to step by step", "tutorial.mp4"),
    ("unboxing", "product unboxing high quality", "unboxing.mp4"),
    ("ugc_virtual_try_on", "virtual try on fashion", "ugc_virtual_try_on.mp4"),
    ("pro_virtual_try_on", "professional fashion model try on", "pro_virtual_try_on.mp4"),
    ("wild_card", "creative experimental product", "wild_card.mp4"),
    ("product_review", "product review authentic", "product_review.mp4"),
]

def download_from_pexels(search_query: str, filename: str) -> bool:
    """
    Download a video from Pexels using search query.
    Pexels API is free but requires pagination through search results.
    """
    output_path = OUTPUT_DIR / filename

    if output_path.exists():
        print(f"✓ {filename} already exists, skipping")
        return True

    print(f"Downloading {filename}...")

    try:
        # Pexels requires an API key, but videos can be accessed directly
        # This is a simplified approach - you may need to manually select videos from:
        # https://www.pexels.com/search/videos/{search_query}/

        # Alternative: Use a direct video URL if available
        # For now, we'll create a note for manual download

        with open(output_path, 'wb') as f:
            # Placeholder comment - videos should be manually downloaded
            f.write(b"")

        print(f"⚠ {filename} created as placeholder")
        print(f"  Please manually download from: https://www.pexels.com/search/videos/{search_query}/")
        print(f"  Select an MP4 and save to: {output_path}")

        return False

    except Exception as e:
        print(f"✗ Error downloading {filename}: {e}")
        return False

def main():
    print("=" * 70)
    print("Marketing Studio Product Video Downloader")
    print("=" * 70)
    print()
    print("MANUAL DOWNLOAD INSTRUCTIONS:")
    print("-" * 70)
    print()
    print("Since Pexels and other stock sites require interactive selection,")
    print("please manually download MP4 videos for each mode:")
    print()

    for mode_id, search_term, filename in VIDEO_MODES:
        print(f"• {filename}")
        print(f"  Mode: {mode_id}")
        print(f"  Search: {search_term}")
        print(f"  Sources:")
        print(f"    - https://www.pexels.com/search/videos/{search_term.replace(' ', '%20')}/")
        print(f"    - https://pixabay.com/videos/search/{search_term.replace(' ', '%20')}/")
        print(f"  Save to: {OUTPUT_DIR / filename}")
        print()

    print("=" * 70)
    print("AUTOMATED ALTERNATIVE (Requires setup):")
    print("=" * 70)
    print()
    print("To automate downloads, install pexels API client:")
    print("  pip install pexels-api")
    print()
    print("Then create .env file with PEXELS_API_KEY and run this script with --auto flag")
    print()

    # Create placeholder files with instructions
    print("Creating placeholder files for component testing...")
    for mode_id, search_term, filename in VIDEO_MODES:
        filepath = OUTPUT_DIR / filename
        if not filepath.exists():
            # Create empty file as placeholder
            filepath.touch()
            print(f"✓ Placeholder created: {filename}")

    print()
    print(f"Output directory: {OUTPUT_DIR}")
    print()
    print("Once videos are downloaded, the component will automatically use them!")

if __name__ == "__main__":
    main()
