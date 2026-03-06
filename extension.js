import St from 'gi://St';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Creates the bluetooth battery indicator which appears in the top panel
const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {

    _init() {
        super._init(0.0, 'Bluetooth Battery');

        // Label shown in the panel
        this.label = new St.Label({text: 'Select Bluetooth Device', yAlign: Clutter.ActorAlign.CENTER,});

        this.add_child(this.label);

        // IDs used to manage DBus signals and refresh timer
        this.signalIds = [];
        this.dbusWatchId = null;
        this.refreshTimerId = null;

        this.watchDBus();

        // Reload device list when the menu opens
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this.loadDevices();
        });

        // Initial device load
        this.loadDevices();

        // Periodically refresh the device list
        this.refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,60,() => {this.loadDevices();
            return GLib.SOURCE_CONTINUE;}
        );
    }

    // Watches for the BlueZ DBus service starting or stopping
    watchDBus() {
        this.dbusWatchId = Gio.bus_watch_name(Gio.BusType.SYSTEM,'org.bluez',Gio.BusNameWatcherFlags.NONE,

            // BlueZ appeared
            () => this.connectBluezSignals(),

            // BlueZ disappeared
            () => {
                this.disconnectBluezSignals();
                this.resetLabel();
                this.loadDevices();
            }
        );
    }

    // Connects DBus signals used to detect bluetooth device changes
    connectBluezSignals() {

        this.disconnectBluezSignals();

        // Device added
        const addedSignalId = Gio.DBus.system.signal_subscribe('org.bluez', 'org.freedesktop.DBus.ObjectManager', 'InterfacesAdded', '/',
            null, Gio.DBusSignalFlags.NONE, () => this.loadDevices());

        // Device removed
        const removedSignalId = Gio.DBus.system.signal_subscribe('org.bluez', 'org.freedesktop.DBus.ObjectManager', 'InterfacesRemoved', '/',
            null, Gio.DBusSignalFlags.NONE, (_conn, _sender, _path, _iface, _signal, params) => {

                const [_objectPath, removedInterfaces] = params.deep_unpack();

                if (removedInterfaces.includes('org.bluez.Device1')) {
                    this.resetLabel();
                    this.loadDevices();
                }
            }
        );

        // Device properties changed (mainly connection state)
        const propertiesSignalId = Gio.DBus.system.signal_subscribe('org.bluez', 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            null, null, Gio.DBusSignalFlags.NONE, (_conn, _sender, _path, _iface, _signal, params) => {

                const [iface, changed] = params.deep_unpack();

                if (iface === 'org.bluez.Device1' && 'Connected' in changed) {

                    const connected = changed['Connected'].unpack();

                    if (!connected)
                        this.resetLabel();

                    this.loadDevices();
                }
            }
        );

        this.signalIds = [addedSignalId, removedSignalId, propertiesSignalId];
    }

    // Disconnects all active DBus signals
    disconnectBluezSignals() {

        for (const id of this.signalIds)
            Gio.DBus.system.signal_unsubscribe(id);

        this.signalIds = [];
    }

    // Resets the panel label text
    resetLabel() {
        this.label.text = 'Select Bluetooth Device';
    }

    // Retrieves bluetooth battery data from UPower
    getUpowerBatteries() {

        const batteries = {};

        try {

            const upowerProxy = Gio.DBusProxy.new_sync(Gio.DBus.system, Gio.DBusProxyFlags.NONE, null,
                'org.freedesktop.UPower', '/org/freedesktop/UPower', 'org.freedesktop.UPower', null);

            const result = upowerProxy.call_sync('EnumerateDevices', null, Gio.DBusCallFlags.NONE, -1, null);

            const devicePaths = result.deep_unpack()[0];

            for (const devicePath of devicePaths) {

                const deviceProxy = Gio.DBusProxy.new_sync(Gio.DBus.system, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
                    devicePath, 'org.freedesktop.DBus.Properties', null);

                // Helper used to safely read DBus properties
                const getProperty = (iface, property) => {
                    try {

                        const result = deviceProxy.call_sync('Get', new GLib.Variant('(ss)', [iface, property]),
                            Gio.DBusCallFlags.NONE, -1, null);

                        const outer = result.deep_unpack()[0];

                        return outer instanceof GLib.Variant ? outer.unpack() : outer;

                    } catch {
                        return null;
                    }
                };

                const deviceType = getProperty('org.freedesktop.UPower.Device', 'Type');

                // Only battery devices
                if (deviceType !== 2)
                    continue;

                const nativePath = getProperty('org.freedesktop.UPower.Device', 'NativePath');

                const percentage = getProperty('org.freedesktop.UPower.Device', 'Percentage');

                if (!nativePath)
                    continue;

                const normalizedPath = nativePath.toLowerCase();

                // Some earbuds report separate left/right batteries
                if (normalizedPath.endsWith('-left')) {

                    const addr = normalizedPath.replace(/-left$/, '');

                    batteries[addr] ??= {};
                    batteries[addr].left = percentage;

                } else if (normalizedPath.endsWith('-right')) {

                    const addr = normalizedPath.replace(/-right$/, '');

                    batteries[addr] ??= {};
                    batteries[addr].right = percentage;

                } else {

                    batteries[normalizedPath] ??= {};
                    batteries[normalizedPath].single = percentage;
                }
            }

        } catch (error) {

            console.error('[BT Battery] UPower error:', error);
        }

        return batteries;
    }

    // Loads connected bluetooth devices and their battery levels
    loadDevices() {

        this.menu.removeAll();

        let managedObjects;

        try {

            const bluezProxy = Gio.DBusProxy.new_sync(Gio.DBus.system, Gio.DBusProxyFlags.NONE,
                null, 'org.bluez', '/', 'org.freedesktop.DBus.ObjectManager', null);

            const result = bluezProxy.call_sync('GetManagedObjects', null, Gio.DBusCallFlags. NONE, -1, null);

            managedObjects = result.deep_unpack()[0];

        } catch (error) {

            console.error('[Bluetooth-Display Status] BlueZ error:', error);

            this.menu.addMenuItem(
                new PopupMenu.PopupMenuItem(`BlueZ error: ${error.message}`)
            );

            return;
        }

        const upowerBatteries = this.getUpowerBatteries();

        let deviceFound = false;
        let primaryLabel = null;

        for (const path in managedObjects) {

            const interfaces = managedObjects[path];

            if (!interfaces['org.bluez.Device1'])
                continue;

            const device = interfaces['org.bluez.Device1'];

            // Only show connected devices
            if (!device['Connected']?.unpack())
                continue;

            const deviceName = device['Name']?.unpack() ?? 'Bluetooth Device';

            const deviceAddress = device['Address']?.unpack()?.toLowerCase() ?? '';

            let batteryText = 'No battery info';

            const upowerData = upowerBatteries[deviceAddress];

            if (upowerData) {

                if (upowerData.left !== undefined && upowerData.right !== undefined) {

                    batteryText = `L: ${Math.round(upowerData.left)}%  R: ${Math.round(upowerData.right)}%`;

                } else if (upowerData.single !== undefined) {

                    batteryText = `${Math.round(upowerData.single)}%`;
                }

            } else if (interfaces['org.bluez.Battery1']) {

                const percent = interfaces['org.bluez.Battery1']['Percentage']?.unpack();

                if (percent !== undefined)
                    batteryText = `${percent}%`;
            }

            const menuItem = new PopupMenu.PopupMenuItem(`${deviceName} - ${batteryText}`);

            // Selecting a device sets the panel label
            menuItem.connect('activate', () => {
                this.label.text = `${deviceName} ${batteryText}`;
            });

            this.menu.addMenuItem(menuItem);

            deviceFound = true;

            if (!primaryLabel)
                primaryLabel = `${deviceName} ${batteryText}`;
        }

        if (primaryLabel)
            this.label.text = primaryLabel;
        else
            this.resetLabel();

        if (!deviceFound) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('No connected devices'));
        }
    }

    // Cleans up timers and DBus watchers
    destroy() {

        if (this.refreshTimerId) {
            GLib.source_remove(this.refreshTimerId);
            this.refreshTimerId = null;
        }

        this.disconnectBluezSignals();

        if (this.dbusWatchId) {
            Gio.bus_unwatch_name(this.dbusWatchId);
            this.dbusWatchId = null;
        }

        super.destroy();
    }
});

// Main extension class
export default class BluetoothBatteryExtension extends Extension {

    // Enables the bluetooth battery indicator
    enable() {

        this.indicator = new Indicator();

        Main.panel.addToStatusArea('bluetooth-battery', this.indicator);
    }

    // Disables the bluetooth battery indicator
    disable() {

        this.indicator?.destroy();
        this.indicator = null;
    }
}