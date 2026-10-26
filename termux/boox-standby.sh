#!/data/data/com.termux/files/usr/bin/sh
# BOOX 待机屏随机轮播：每 30 分钟从 Cloudflare Worker 拉一页随机 PNG 并设为待机画面。
# 由 Termux:Boot 在开机时自动执行；也可手动: sh boox-standby.sh &

DIR=/sdcard/Android/data/com.termux/files
URL=https://boox.qiaclass.com   # 换成你自己的 Worker 自定义域名（workers.dev 国内不可达）

termux-wake-lock
while true; do
    curl -s -o "$DIR/standby.png" "$URL/random.png" \
        && am broadcast -a onyx.action.SCREENSAVER \
            --ei type 16 --es file "$DIR/standby.png" >/dev/null
    sleep 1800
done
