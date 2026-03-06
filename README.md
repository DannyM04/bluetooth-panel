# Bluetooth Battery Monitor

A GNOME Shell extension that displays battery levels of connected Bluetooth devices directly in the top panel.

The extension automatically detects connected Bluetooth devices and shows their battery percentage in the panel menu.


### Current Features:
- Displays battery percentage for connected Bluetooth devices
- Supports devices that report battery via BlueZ or UPower
- Supports dual battery devices (such as wireless earbuds with left/right batteries)
- Dropdown menu to view connected devices and their battery levels
- Panel indicator that updates when Bluetooth devices connect or disconnect

### Prerequisites:
GNOME Shell 46 or newer
BlueZ (Bluetooth stack used by Linux)
UPower (for battery reporting on some devices)


### Installation:

Clone the repository and copy the extension into your local GNOME extensions directory.

git clone https://github.com/DannyM04/bluetooth-panel.git

mkdir -p ~/.local/share/gnome-shell/extensions/bluetooth-panel@dannym04

cp -r bluetooth-panel/* ~/.local/share/gnome-shell/extensions/bluetooth-panel@dannym04


### Enable the extension:

gnome-extensions enable bluetooth-panel@dannym04


### Notes:
- Some Bluetooth devices do not report battery levels and may appear as "No battery info".
- This extension relies on system Bluetooth services (BlueZ) and may behave differently depending on the device.

### Optional: Install Script (Auto Enable)

You can create a simple script to install and enable the extension automatically.

Create a file called install.sh in the project directory:

```bash
#!/bin/bash

UUID="bluetooth-panel@dannym04"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$EXT_DIR"
cp -r * "$EXT_DIR"

gnome-extensions enable "$UUID"
gnome-extensions reload "$UUID" 2>/dev/null

echo "Bluetooth Battery Monitor installed and enabled."

chmod +x install.sh

./install.sh
```