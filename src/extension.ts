import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Ornament } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

const ByteArray = imports.byteArray;

const PowerDaemon = Gio.DBusProxy.makeProxyWrapper(
'<node>\
  <interface name="com.system76.PowerDaemon">\
    <method name="Performance"/>\
    <method name="Balanced"/>\
    <method name="Battery"/>\
    <method name="GetProfile">\
        <arg name="profile" type="s" direction="out"/>\
    </method>\
    <method name="GetExternalDisplaysRequireDgpu">\
      <arg name="required" type="b" direction="out"/>\
    </method>\
    <method name="GetGraphics">\
      <arg name="vendor" type="s" direction="out"/>\
    </method>\
    <method name="SetGraphics">\
      <arg name="vendor" type="s" direction="in"/>\
    </method>\
    <method name="GetSwitchable">\
      <arg name="switchable" type="b" direction="out"/>\
    </method>\
    <method name="GetGraphicsPower">\
      <arg name="power" type="b" direction="out"/>\
    </method>\
    <method name="SetGraphicsPower">\
      <arg name="power" type="b" direction="in"/>\
    </method>\
    <method name="AutoGraphicsPower"/>\
    <signal name="HotPlugDetect">\
      <arg name="port" type="t"/>\
    </signal>\
    <signal name="PowerProfileSwitch">\
      <arg name="profile" type="s"/>\
    </signal>\
  </interface>\
</node>'
);

const GRAPHICS: string = _(" Graphics");

const DISABLE_EXT_DISPLAYS: string = _("Disables external displays.\nRequires restart.");
const ENABLE_FOR_EXT_DISPLAYS: string = _("Enable for external displays.\nRequires restart.");
const REQUIRES_RESTART: string = _("Requires restart.");

const DMI_PRODUCT_VERSION_PATH = "/sys/class/dmi/id/product_version";

let PRODUCT_VERSION = "";

let ext: Ext | null = null;

function log(text: string) {
    (globalThis as any).log("gnome-shell-extension-system76-power: " + text);
}

export default class System76PowerExtension {
    init() {
        let file = Gio.File.new_for_path(DMI_PRODUCT_VERSION_PATH);
        let [, contents] = file.load_contents(null);
        PRODUCT_VERSION = ByteArray.toString(contents).trim();
    }

    enable() {
        if (null === ext) {
            ext = new Ext();
        }
    }

    disable() {
        if (ext) ext.destroy();
        ext = null;
    }
}

var PopDialog = GObject.registerClass(
    class PopDialog extends ModalDialog.ModalDialog {
        _init(_icon_name: string, title: string, description: string, params: any) {
            super._init(params);

            // NOTE: Icons were removed in 3.36
            this._content = new Dialog.MessageDialogContent({ title, description });
            this.contentLayout.add_child(this._content);
        }
    }
);

var PopupGraphicsMenuItem = GObject.registerClass(
    class PopupGraphicsMenuItem extends PopupMenu.PopupBaseMenuItem {
        _init(title: string, text: string | null, params: any) {
            super._init(params);

            this.box = new St.BoxLayout({ vertical: true });
            this.label = new St.Label({
                style_class: "pop-menu-title",
                text: title,
            });

            this.description = new St.Label({
                style_class: "pop-menu-description",
                text: "",
            });

            if (text != null) {
                this.description.text = text;
            } else {
                this.description.hide();
            }

            this.box.add_child(this.label);
            this.box.add_child(this.description);
            this.actor.add_child(this.box);
            this.actor.label_actor = this.box;
        }
    }
);

declare interface GObj {
    [x: string]: any
}

interface GraphicsProfiles {
    integrated: GObj;
    nvidia: GObj;
    hybrid: GObj;
    compute: GObj;
}

var GraphicsQuickMenuToggle = GObject.registerClass(
    class GraphicsQuickMenuToggle extends QuickSettings.QuickMenuToggle {
        _init() {
            super._init({
                title: _("Graphics"),
                iconName: 'video-display-symbolic',
                toggleMode: false,
            });

            this.menu.setHeader('video-display-symbolic', _("Graphics Mode"));
        }

        setActiveProfile(profileName: string) {
            this.subtitle = profileName;
        }
    }
);

export class Ext {
    bus: GObj = new PowerDaemon(Gio.DBus.system, 'com.system76.PowerDaemon', '/com/system76/PowerDaemon');

    graphics_profiles: GraphicsProfiles | null = null;

    quickSettingsMenu: any = null;
    graphics_toggle: any = null;
    graphics_indicator: any = null;

    switched: boolean = false;
    notified: boolean = false;

    constructor() {
        this.bus.set_default_timeout(300000);

        try {
            if (this.bus.GetSwitchableSync() == "true") {
                let ext_requires_nvidia: boolean = this.bus.GetExternalDisplaysRequireDgpuSync() == "true";
                let graphics: string = this.bus.GetGraphicsSync();

                // Create Quick Settings menu toggle for graphics
                this.graphics_toggle = new GraphicsQuickMenuToggle();
                
                let compute_text: string | null = null,
                    hybrid_text: string | null = null,
                    integrated_text: string | null = null,
                    nvidia_text: string | null = null;

                if (ext_requires_nvidia) {
                    if (graphics == "compute") {
                        hybrid_text = ENABLE_FOR_EXT_DISPLAYS;
                        integrated_text = REQUIRES_RESTART;
                        nvidia_text = ENABLE_FOR_EXT_DISPLAYS;
                    } else if (graphics == "hybrid") {
                        compute_text = DISABLE_EXT_DISPLAYS;
                        integrated_text = DISABLE_EXT_DISPLAYS;
                        nvidia_text = REQUIRES_RESTART;
                    } else if (graphics == "integrated") {
                        compute_text = REQUIRES_RESTART;
                        hybrid_text = ENABLE_FOR_EXT_DISPLAYS;
                        nvidia_text = ENABLE_FOR_EXT_DISPLAYS;
                    } else {
                        compute_text = DISABLE_EXT_DISPLAYS;
                        hybrid_text = REQUIRES_RESTART;
                        integrated_text = DISABLE_EXT_DISPLAYS;
                    }
                } else if (graphics == "compute") {
                    hybrid_text = REQUIRES_RESTART;
                    integrated_text = REQUIRES_RESTART;
                    nvidia_text = REQUIRES_RESTART;
                } else if (graphics == "hybrid") {
                    compute_text = REQUIRES_RESTART;
                    integrated_text = REQUIRES_RESTART;
                    nvidia_text = REQUIRES_RESTART;
                } else if (graphics == "integrated") {
                    compute_text = REQUIRES_RESTART;
                    hybrid_text = REQUIRES_RESTART;
                    nvidia_text = REQUIRES_RESTART;
                } else {
                    compute_text = REQUIRES_RESTART;
                    hybrid_text = REQUIRES_RESTART;
                    integrated_text = REQUIRES_RESTART;
                }

                this.graphics_profiles = {
                    integrated: this.attach_graphics_profile("Integrated", integrated_text, "integrated"),
                    nvidia: this.attach_graphics_profile("NVIDIA", nvidia_text, "nvidia"),
                    hybrid: this.attach_graphics_profile("Hybrid", hybrid_text, "hybrid"),
                    compute: this.attach_graphics_profile("Compute", compute_text, "compute"),
                };

                this.set_graphics_profile_ornament(this.graphics_profiles, graphics);
                
                // Update the toggle subtitle with current profile
                let profileName = graphics.charAt(0).toUpperCase() + graphics.slice(1);
                this.graphics_toggle.setActiveProfile(profileName);

                // Add to Quick Settings
                this.quickSettingsMenu = Main.panel.statusArea.quickSettings;
                this.quickSettingsMenu.addExternalIndicator(this.graphics_toggle);

                this.bus.connectSignal("HotPlugDetect", (proxy: any, _nameOwner: any, args: any) => {
                    if (this.graphics_profiles) {
                        log("hotplug event detected");
                        let graphics: string = proxy.GetGraphicsSync();

                        let current = null;
                        if (graphics == "compute") {
                            current = "Compute";
                        } else if (graphics == "integrated") {
                            current = "Integrated";
                        }

                        if (current) {
                            this.hotplug(current, this.graphics_profiles.hybrid, "Hybrid", "hybrid");
                        } else if (PRODUCT_VERSION == "serw13" && args[0] == 0) {
                            this.hotplug_less_capable();
                        }

                        if (graphics == "hybrid") {
                            // Force display server update
                            // XXX: Use org.gnome.Mutter.DisplayConfig instead?
                            Util.trySpawn(["xrandr", "-q"]);
                        }
                    }
                });
            }
        } catch (error) {
            log("failed to detect graphics switching: " + error);
        }
    }

    destroy() {
        if (this.graphics_profiles) {
            this.graphics_profiles.compute.destroy();
            this.graphics_profiles.hybrid.destroy();
            this.graphics_profiles.integrated.destroy();
            this.graphics_profiles.nvidia.destroy();
        }

        if (this.graphics_toggle) {
            this.quickSettingsMenu._indicators.remove_child(this.graphics_toggle);
            this.quickSettingsMenu.menu._grid.remove_child(this.graphics_toggle);
            this.graphics_toggle.destroy();
        }
    }

    attach_graphics_profile(name: string, text: string | null, profile: string) {
        let obj = new PopupGraphicsMenuItem(name + GRAPHICS, text);
        obj.setting = false;
        obj.connect('activate', (item: any) => {
            this.graphics_activate(item, name, profile);
        });
        this.graphics_toggle.menu.addMenuItem(obj);
        return obj;
    }

    set_graphics_profile_ornament(graphics_profiles: GObj, graphics: string) {
        this.reset_graphics_ornament(graphics_profiles);

        let obj;
        if (graphics == "compute") {
            obj = graphics_profiles.compute;
        } else if (graphics == "hybrid") {
            obj = graphics_profiles.hybrid;
        } else if (graphics == "integrated") {
            obj = graphics_profiles.integrated;
        } else if (graphics == "nvidia") {
            obj = graphics_profiles.nvidia;
        }

        obj.setOrnament(Ornament.CHECK);
    }

    /** Display dialog on hotplug event. */
    hotplug(current: string, item: any, name: string, vendor: string) {
        if (this.switched || this.notified) {
            return;
        }

        this.notified = true;
        let dialog = new PopDialog(
            "video-display-symbolic",
            _("Switch to ") + name + GRAPHICS + _(" to use external displays"),
            _("External displays are connected to the NVIDIA card. Switch to ") + name + _(" graphics to use them."),
        );
        dialog.open();

        dialog.setButtons([{
            action: () => {
                dialog.close();
            },
            label: _("Continue using ") + current,
            key: Clutter.Escape
        }, {
            action: () => {
                dialog.close();
                this.graphics_activate(item, name, vendor);
            },
            label: _("Switch to ") + name,
            key: Clutter.Enter
        }]);
    }

    /** Display dialog on hotplug to less capable port event. */
    hotplug_less_capable() {
        let dialog = new PopDialog(
            "video-display-symbolic",
            _("The Thunderbolt Port is Recommended"),
            _("Use the Thunderbolt port for the best external monitor\nexperience. It is located next to the USB-C port you\nplugged into."),
        );
        dialog.open();

        dialog.setButtons([{
            action: () => {
                dialog.close();
            },
            label: _("Close"),
            key: Clutter.Enter
        }]);
    }

    /** Ask if the user wants to switch graphics, and then switches graphics. */
    graphics_activate(item: any, name: string, vendor: string) {
        this.switched = true;
        if (!item.setting) {
            item.setting = true;

            let dialog = new PopDialog(
                "dialog-warning-symbolic",
                _("Preparing to Switch to ") + name + GRAPHICS,
                name + _(" graphics will be enabled on the next restart"),
            );
            dialog.open();

            this.bus.SetGraphicsRemote(vendor, (_result: any, error: string | null) => {
                item.setting = false;

                if (this.graphics_profiles && error == null) {
                    dialog._content.title = _("Restart to Switch to ") + name + GRAPHICS;
                    dialog._content.description = _("Switching to ") + name + _(" will close all open apps and restart your device. You may lose any unsaved work.");

                    let reboot_msg = _("Will be enabled on\nthe next restart.");
                    if (name == "Compute") {
                        this.graphics_profiles.compute.description.text = reboot_msg;
                        this.graphics_profiles.compute.description.show();

                        this.graphics_profiles.hybrid.description.hide();
                        this.graphics_profiles.integrated.description.hide();
                        this.graphics_profiles.nvidia.description.hide();
                    } else if (name == "Hybrid") {
                        this.graphics_profiles.hybrid.description.text = reboot_msg;
                        this.graphics_profiles.hybrid.description.show();

                        this.graphics_profiles.compute.description.hide();
                        this.graphics_profiles.integrated.description.hide();
                        this.graphics_profiles.nvidia.description.hide();
                    } else if (name == "Integrated") {
                        this.graphics_profiles.integrated.description.text = reboot_msg;
                        this.graphics_profiles.integrated.description.show();

                        this.graphics_profiles.compute.description.hide();
                        this.graphics_profiles.hybrid.description.hide();
                        this.graphics_profiles.nvidia.description.hide();
                    } else {
                        this.graphics_profiles.nvidia.description.text = reboot_msg;
                        this.graphics_profiles.nvidia.description.show();

                        this.graphics_profiles.compute.description.hide();
                        this.graphics_profiles.hybrid.description.hide();
                        this.graphics_profiles.integrated.description.hide();
                    }

                    dialog.setButtons([{
                        action: () => {
                            dialog.close();
                        },
                        label: _("Restart Later"),
                        key: Clutter.Escape
                    }, {
                        action: () => {
                            dialog.close();
                            this.reboot();
                        },
                        label: _("Restart and Switch"),
                        key: Clutter.Enter
                    }]);
                } else {
                    log("failed to switch: " + error);

                    dialog._content.title = _("Failed to switch to ") + name;
                    dialog._content.description = "";

                    dialog.setButtons([{
                        action: () => {
                            dialog.close();
                        },
                        label: "Close",
                        key: Clutter.Escape
                    }]);
                }
            });
        }
    }

    reboot() {
        Util.trySpawn(["systemctl", "reboot"]);
    }

    reset_graphics_ornament(graphics_profiles: GObj) {
        graphics_profiles.compute.setOrnament(Ornament.NONE);
        graphics_profiles.hybrid.setOrnament(Ornament.NONE);
        graphics_profiles.integrated.setOrnament(Ornament.NONE);
        graphics_profiles.nvidia.setOrnament(Ornament.NONE);
    }
}


