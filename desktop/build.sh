#!/bin/sh
# Build "Agent Office Pet.app" ke ~/Applications dan pasang launchd agar menyala saat login.
set -e
cd "$(dirname "$0")"
APP="$HOME/Applications/Agent Office Pet.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/AgentOfficePet" AgentOfficePet.swift -framework Cocoa -framework WebKit
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.agent-office.pet</string>
  <key>CFBundleName</key><string>Agent Office Pet</string>
  <key>CFBundleExecutable</key><string>AgentOfficePet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

PLIST="$HOME/Library/LaunchAgents/local.agent-office-pet.plist"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.agent-office-pet</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/AgentOfficePet</string></array>
  <key>RunAtLoad</key><true/>
  <!-- Hidup lagi kalau crash; "Keluar" dari menu (exit 0) tidak dihidupkan lagi sampai login berikutnya. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/local.agent-office-pet" 2>/dev/null || true
# bootout perlu sesaat sebelum label bisa dipasang lagi
for i in 1 2 3 4 5; do launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break; sleep 1; done
echo "Terpasang: $APP"
