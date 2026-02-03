#!/bin/bash
# Install MoltApp heartbeat as a launchd service (macOS) or cron job
# Runs every 30 minutes, fully autonomous
#
# Usage: ./scripts/install-heartbeat.sh [install|uninstall|status]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HEARTBEAT_SCRIPT="$SCRIPT_DIR/heartbeat.sh"
PLIST_NAME="com.moltapp.heartbeat"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

install_launchd() {
    echo "Installing MoltApp heartbeat as launchd service..."

    mkdir -p "$HOME/Library/LaunchAgents"

    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$HEARTBEAT_SCRIPT</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/heartbeat-launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/heartbeat-launchd-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
EOF

    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load "$PLIST_PATH"

    echo "Installed and started!"
    echo "  Plist: $PLIST_PATH"
    echo "  Interval: every 30 minutes"
    echo "  Log: $SCRIPT_DIR/heartbeat.log"
    echo ""
    echo "Commands:"
    echo "  Check status:  launchctl list | grep moltapp"
    echo "  View log:      tail -f $SCRIPT_DIR/heartbeat.log"
    echo "  View build:    tail -f $SCRIPT_DIR/build.log"
    echo "  Stop:          launchctl unload $PLIST_PATH"
    echo "  Restart:       launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
    echo "  Run now:       $HEARTBEAT_SCRIPT"
}

uninstall_launchd() {
    echo "Uninstalling MoltApp heartbeat..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "Uninstalled."
}

show_status() {
    echo "MoltApp Heartbeat Status"
    echo "========================"

    if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
        echo "Service: RUNNING"
        launchctl list | grep "$PLIST_NAME"
    else
        echo "Service: NOT RUNNING"
    fi

    echo ""

    if [ -f "$SCRIPT_DIR/heartbeat-state.json" ]; then
        echo "State:"
        cat "$SCRIPT_DIR/heartbeat-state.json" | jq .
    fi

    echo ""

    if [ -f "$SCRIPT_DIR/heartbeat.log" ]; then
        echo "Last 10 log lines:"
        tail -10 "$SCRIPT_DIR/heartbeat.log"
    fi

    echo ""

    if [ -f "$SCRIPT_DIR/heartbeat-build.pid" ]; then
        local pid=$(cat "$SCRIPT_DIR/heartbeat-build.pid")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Build session: RUNNING (PID: $pid)"
        else
            echo "Build session: NOT RUNNING (stale PID: $pid)"
        fi
    else
        echo "Build session: NOT RUNNING"
    fi
}

case "${1:-install}" in
    install)
        install_launchd
        ;;
    uninstall)
        uninstall_launchd
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 [install|uninstall|status]"
        exit 1
        ;;
esac
