#!/usr/bin/env bash
#
# YouTube Bulk Download Stress Test
#
# Tests whether a server can download YouTube videos at scale without proxy.
# Designed for Ubuntu VPS (Hetzner, Contabo, etc.)
#
# Usage:
#   curl -O https://cerul-1304425019.cos.ap-hongkong.myqcloud.com/test_bulk_download.sh
#   curl -O https://cerul-1304425019.cos.ap-hongkong.myqcloud.com/video_ids.txt
#   chmod +x test_bulk_download.sh
#
#   ./test_bulk_download.sh              # default: 3 concurrent, 480p
#   ./test_bulk_download.sh -j 5 -r 720  # 5 concurrent, 720p
#   ./test_bulk_download.sh -j 10        # stress test: 10 concurrent
#

set -euo pipefail

# ─── Defaults ───────────────────────────────────────────────────────────
CONCURRENCY=3
RESOLUTION=480
DELAY_MIN=2
DELAY_MAX=8
OUTPUT_DIR="./yt_test_downloads"
VIDEO_LIST="./video_ids.txt"
LOG_FILE="./download_test_results.log"
ERROR_DIR="./yt_test_errors"
KEEP_FILES=false

# Pin yt-dlp to a known working version (newer versions may have PO Token issues)
YTDLP_VERSION="2025.06.09"

# ─── Parse args ─────────────────────────────────────────────────────────
usage() {
    echo "Usage: $0 [-j CONCURRENCY] [-r RESOLUTION] [-d OUTPUT_DIR] [-l VIDEO_LIST] [-k]"
    echo "  -j  Concurrent downloads (default: 3)"
    echo "  -r  Max resolution: 480 or 720 (default: 480)"
    echo "  -d  Output directory (default: ./yt_test_downloads)"
    echo "  -l  Video ID list file (default: ./video_ids.txt)"
    echo "  -k  Keep downloaded files (default: delete after test)"
    exit 1
}

while getopts "j:r:d:l:kh" opt; do
    case $opt in
        j) CONCURRENCY=$OPTARG ;;
        r) RESOLUTION=$OPTARG ;;
        d) OUTPUT_DIR=$OPTARG ;;
        l) VIDEO_LIST=$OPTARG ;;
        k) KEEP_FILES=true ;;
        h) usage ;;
        *) usage ;;
    esac
done

# ─── Preflight checks ──────────────────────────────────────────────────
install_deps() {
    echo "=== Installing dependencies ==="
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3 python3-pip ffmpeg curl bc > /dev/null 2>&1

    # Install pinned yt-dlp version
    echo "Installing yt-dlp ${YTDLP_VERSION}..."
    sudo curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
        -o /usr/local/bin/yt-dlp
    sudo chmod a+rx /usr/local/bin/yt-dlp

    echo "yt-dlp version: $(yt-dlp --version)"
    echo "ffmpeg version: $(ffmpeg -version 2>&1 | head -1)"
}

# Install if missing, warn if version differs
if ! command -v yt-dlp &> /dev/null || ! command -v ffmpeg &> /dev/null; then
    install_deps
else
    CURRENT_VERSION=$(yt-dlp --version 2>/dev/null || echo "none")
    if [ "$CURRENT_VERSION" != "$YTDLP_VERSION" ]; then
        echo "WARNING: yt-dlp version $CURRENT_VERSION (recommended: $YTDLP_VERSION)"
        echo "  If downloads fail, run: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp"
    fi
    echo "yt-dlp version: $(yt-dlp --version)"
    echo "ffmpeg version: $(ffmpeg -version 2>&1 | head -1)"
fi

if [ ! -f "$VIDEO_LIST" ]; then
    echo "ERROR: Video list not found: $VIDEO_LIST"
    echo "Create it with one YouTube video ID per line."
    exit 1
fi

TOTAL_VIDEOS=$(wc -l < "$VIDEO_LIST" | tr -d ' ')
mkdir -p "$OUTPUT_DIR"
mkdir -p "$ERROR_DIR"

# ─── Format string ─────────────────────────────────────────────────────
FORMAT="18/bestvideo[height<=${RESOLUTION}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${RESOLUTION}]+bestaudio/best[height<=${RESOLUTION}]/best"

# ─── Stats ──────────────────────────────────────────────────────────────
SUCCESS_COUNT=0
FAIL_COUNT=0
RATE_LIMITED=0
TOTAL_BYTES=0
START_TIME=$(date +%s)

# Initialize log
cat > "$LOG_FILE" << EOF
YouTube Bulk Download Test
==========================
Date:        $(date -u '+%Y-%m-%d %H:%M:%S UTC')
Server:      $(hostname) / $(curl -s ifconfig.me 2>/dev/null || echo "unknown")
yt-dlp:      $(yt-dlp --version)
Videos:      $TOTAL_VIDEOS
Concurrency: $CONCURRENCY
Resolution:  ${RESOLUTION}p
Delay:       ${DELAY_MIN}-${DELAY_MAX}s between downloads

Results:
--------
EOF

echo ""
echo "======================================================================"
echo "  YouTube Bulk Download Stress Test"
echo "======================================================================"
echo "  Videos:      $TOTAL_VIDEOS"
echo "  Concurrency: $CONCURRENCY"
echo "  Resolution:  ${RESOLUTION}p"
echo "  yt-dlp:      $(yt-dlp --version)"
echo "  Output:      $OUTPUT_DIR"
echo "  Keep files:  $KEEP_FILES"
echo "======================================================================"
echo ""

# ─── Download function ──────────────────────────────────────────────────
download_one() {
    local video_id="$1"
    local index="$2"
    local t0=$(date +%s%N)
    local error_file="${ERROR_DIR}/${video_id}.log"

    local output_template="${OUTPUT_DIR}/${video_id}.%(ext)s"

    # Random delay to avoid burst patterns
    local delay=$(( RANDOM % (DELAY_MAX - DELAY_MIN + 1) + DELAY_MIN ))
    sleep "$delay"

    # Run yt-dlp, capture exit code and stderr separately
    local exit_code=0
    yt-dlp \
        --no-playlist \
        -f "$FORMAT" \
        --output "$output_template" \
        --socket-timeout 30 \
        --retries 3 \
        --no-overwrites \
        --verbose \
        "https://www.youtube.com/watch?v=${video_id}" \
        > "$error_file" 2>&1 || exit_code=$?

    local t1=$(date +%s%N)
    local elapsed=$(( (t1 - t0) / 1000000 ))  # ms

    # Check result
    local file_path=""
    local file_size=0
    local status="FAIL"
    local error_msg=""

    # Find downloaded file (check multiple extensions)
    for ext in mp4 webm mkv m4a; do
        if [ -f "${OUTPUT_DIR}/${video_id}.${ext}" ]; then
            file_path="${OUTPUT_DIR}/${video_id}.${ext}"
            file_size=$(stat -c%s "$file_path" 2>/dev/null || stat -f%z "$file_path" 2>/dev/null || echo 0)
            break
        fi
    done

    # Extract key log lines (format selected, download info, errors)
    local format_info
    format_info=$(grep -E "^\[info\].*Downloading|format(s):" "$error_file" 2>/dev/null | tail -1 || echo "")
    local download_info
    download_info=$(grep -E "^\[download\] 100%" "$error_file" 2>/dev/null | tail -1 || echo "")
    local merge_info
    merge_info=$(grep -E "^\[Merger\]" "$error_file" 2>/dev/null | tail -1 || echo "")
    local error_line
    error_line=$(grep -i "^ERROR" "$error_file" 2>/dev/null | tail -1 || echo "")

    if [ -n "$file_path" ] && [ "$file_size" -gt 10000 ]; then
        status="OK"
        local size_mb=$(echo "scale=1; $file_size / 1048576" | bc)
        local speed_mbps=""
        if [ "$elapsed" -gt 0 ]; then
            speed_mbps=$(echo "scale=1; $file_size * 8 / $elapsed / 1000" | bc 2>/dev/null || echo "?")
        fi
        printf "[%3d/%d] %-15s %5s  %6s MB  %4s Mbps  %5dms\n" \
            "$index" "$TOTAL_VIDEOS" "$video_id" "$status" "$size_mb" "$speed_mbps" "$elapsed"
        # Print key log lines
        [ -n "$format_info" ] && printf "         ├── %s\n" "$format_info"
        [ -n "$merge_info" ]  && printf "         └── %s\n" "$merge_info"
        echo "$video_id  $status  ${size_mb}MB  ${speed_mbps}Mbps  ${elapsed}ms" >> "$LOG_FILE"

        # Clean up video file if not keeping
        if [ "$KEEP_FILES" = false ]; then
            rm -f "$file_path"
        fi
        rm -f "$error_file"
    else
        # If no ERROR line found, grab last meaningful lines
        if [ -z "$error_line" ]; then
            error_line=$(grep -v "^\[debug\]" "$error_file" 2>/dev/null | grep -v "^WARNING" | tail -3 | head -1 || echo "unknown")
        fi

        # Classify error
        if echo "$error_line" | grep -qi "429\|too many\|rate limit"; then
            error_msg="RATE_LIMITED"
        elif echo "$error_line" | grep -qi "403\|forbidden\|Sign in\|bot"; then
            error_msg="BOT_BLOCKED"
        elif echo "$error_line" | grep -qi "not available\|unavailable\|removed\|private"; then
            error_msg="UNAVAILABLE"
        elif echo "$error_line" | grep -qi "geo\|country\|region"; then
            error_msg="GEO_BLOCKED"
        elif echo "$error_line" | grep -qi "po.token\|PO Token"; then
            error_msg="PO_TOKEN"
        elif echo "$error_line" | grep -qi "timed out\|timeout"; then
            error_msg="TIMEOUT"
        elif [ "$exit_code" -ne 0 ]; then
            error_msg="EXIT_${exit_code}"
        else
            error_msg="UNKNOWN"
        fi

        printf "[%3d/%d] %-15s %5s  (%s)  %5dms\n" \
            "$index" "$TOTAL_VIDEOS" "$video_id" "FAIL" "$error_msg" "$elapsed"
        # Print the actual error for debugging
        printf "         └── %s\n" "$error_line"
        echo "$video_id  FAIL  $error_msg  ${elapsed}ms  $error_line" >> "$LOG_FILE"

        # Clean up partial files
        rm -f "${OUTPUT_DIR}/${video_id}".*
    fi

    # Return status via temp file (bash subshell limitation)
    echo "$status $file_size $error_msg" > "${OUTPUT_DIR}/.yt_test_${video_id}.status"
}

export -f download_one
export OUTPUT_DIR FORMAT DELAY_MIN DELAY_MAX TOTAL_VIDEOS LOG_FILE KEEP_FILES ERROR_DIR

# ─── Run downloads ──────────────────────────────────────────────────────
echo "Starting downloads..."
echo ""
printf "%-8s %-15s %5s  %8s  %10s  %7s\n" "Index" "Video ID" "Status" "Size" "Speed" "Time"
echo "--------------------------------------------------------------"

# Manual concurrency with background jobs
INDEX=0
while IFS= read -r video_id; do
    # Skip empty lines
    [ -z "$video_id" ] && continue
    INDEX=$((INDEX + 1))
    download_one "$video_id" "$INDEX" &

    # Limit concurrency
    while [ "$(jobs -r | wc -l)" -ge "$CONCURRENCY" ]; do
        sleep 1
    done
done < "$VIDEO_LIST"
wait

# ─── Collect stats ──────────────────────────────────────────────────────
END_TIME=$(date +%s)
WALL_TIME=$((END_TIME - START_TIME))
[ "$WALL_TIME" -eq 0 ] && WALL_TIME=1

for f in "${OUTPUT_DIR}"/.yt_test_*.status; do
    [ -f "$f" ] || continue
    read -r s size err < "$f"
    if [ "$s" = "OK" ]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        TOTAL_BYTES=$((TOTAL_BYTES + size))
    else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        [ "$err" = "RATE_LIMITED" ] && RATE_LIMITED=$((RATE_LIMITED + 1))
    fi
    rm -f "$f"
done

TOTAL_GB=$(echo "scale=2; $TOTAL_BYTES / 1073741824" | bc 2>/dev/null || echo "?")
AVG_SPEED=$(echo "scale=1; $TOTAL_BYTES * 8 / $WALL_TIME / 1000000" | bc 2>/dev/null || echo "?")
SUCCESS_RATE=$(echo "scale=1; $SUCCESS_COUNT * 100 / $TOTAL_VIDEOS" | bc 2>/dev/null || echo "?")

# ─── Summary ────────────────────────────────────────────────────────────
SUMMARY=$(cat << EOF

======================================================================
  DOWNLOAD TEST RESULTS
======================================================================
  Total videos:     $TOTAL_VIDEOS
  Successful:       $SUCCESS_COUNT ($SUCCESS_RATE%)
  Failed:           $FAIL_COUNT
  Rate limited:     $RATE_LIMITED

  Total downloaded: ${TOTAL_GB} GB
  Wall time:        ${WALL_TIME}s ($(echo "scale=1; $WALL_TIME / 60" | bc)m)
  Avg throughput:   ${AVG_SPEED} Mbps
  Concurrency:      $CONCURRENCY
  Resolution:       ${RESOLUTION}p

  Server IP:        $(curl -s ifconfig.me 2>/dev/null || echo "unknown")
======================================================================

VERDICT:
EOF
)

if [ "$RATE_LIMITED" -gt 5 ]; then
    SUMMARY+="  YouTube is rate-limiting this IP."
    SUMMARY+=$'\n'"  Reduce concurrency or add delays."
elif [ "$FAIL_COUNT" -gt "$((TOTAL_VIDEOS / 4))" ]; then
    SUMMARY+="  High failure rate. Check error logs in ${ERROR_DIR}/"
    SUMMARY+=$'\n'"  May need proxy, different IP, or yt-dlp version change."
elif [ "$SUCCESS_COUNT" -eq "$TOTAL_VIDEOS" ]; then
    SUMMARY+="  ALL PASSED. This server can handle bulk downloads."
    SUMMARY+=$'\n'"  Safe for cold-start indexing at concurrency=$CONCURRENCY."
else
    SUMMARY+="  Mostly OK. Review failed videos — check ${ERROR_DIR}/ for details."
fi

echo "$SUMMARY"
echo "" >> "$LOG_FILE"
echo "$SUMMARY" >> "$LOG_FILE"

# Show error summary if any failures
if [ "$FAIL_COUNT" -gt 0 ] && [ -d "$ERROR_DIR" ]; then
    ERROR_COUNT=$(ls "$ERROR_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo ""
        echo "Error logs saved to ${ERROR_DIR}/ ($ERROR_COUNT files)"
        echo "View a specific error: cat ${ERROR_DIR}/<video_id>.log"
    fi
fi

echo ""
echo "Full log: $LOG_FILE"

# Cleanup output dir
if [ "$KEEP_FILES" = false ]; then
    rm -rf "$OUTPUT_DIR" 2>/dev/null || true
fi
