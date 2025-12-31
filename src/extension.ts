import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Ornament } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Detect GNOME Shell version - parse major version only
const shellVersionParts = Config.PACKAGE_VERSION.split('.');
const shellMajorVersion = parseInt(shellVersionParts[0], 10);
const useQuickSettings = shellMajorVersion >= 45;

// Conditionally import QuickSettings for GNOME 45+
let QuickSettings: any = null;
if (useQuickSettings) {
    QuickSettings = await import('resource:///org/gnome/shell/ui/quickSettings.js');
}

// Determine if we can actually use Quick Settings (both version check and import succeeded)
const canUseQuickSettings = useQuickSettings && QuickSettings !== null;

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
    <method name="GetGraphicsSync">\
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

export default class System76PowerExtension extends Extension {
    enable() {
        if (null === ext) {
            try {
                let file = Gio.File.new_for_path(DMI_PRODUCT_VERSION_PATH);
                let [, contents] = file.load_contents(null);
                // Convert Uint8Array to string
                PRODUCT_VERSION = String.fromCharCode(...contents).trim();
            } catch (e) {
                log('Failed to read product version: ' + e);
                PRODUCT_VERSION = '';
            }
            
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

// Panel indicator for GNOME 43-44
var PanelIndicator = GObject.registerClass(
    class PanelIndicator extends PanelMenu.Button {
      _init() {
        super._init(0.0, "S76Panel", false);

        this.add_style_class_name('panel-status-button');

        this._indicatorLayout = new St.BoxLayout({
            vertical: false,
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this._binProfile = new St.Bin({ 
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this._iconProfile = new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon'
        });

        this._binProfile.add_child(this._iconProfile);

        this._indicatorLayout.add_child(this._binProfile);

        // add indicator to panel icon
        this.add_child(this._indicatorLayout);

        this.menu.connect('open-state-changed', (_: any, open: boolean) => {
            if (open)
                this._indicatorLayout.add_style_pseudo_class('active');
            else
                this._indicatorLayout.remove_style_pseudo_class('active');
        });

        Main.panel.addToStatusArea('s76-power.panel', this);
      }
    }
);

// Quick Settings toggle for GNOME 45+
var System76GraphicsQuickMenuToggle: typeof QuickSettings.QuickMenuToggle = null;
let ServiceIndicator: typeof QuickSettings.SystemIndicator = null;
if (canUseQuickSettings) {
    const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

    System76GraphicsQuickMenuToggle = GObject.registerClass({
    GTypeName: 'System76GraphicsQuickMenuToggle',
}, class ServiceToggle extends QuickSettings.QuickMenuToggle {
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

 ServiceIndicator = GObject.registerClass(
class ServiceIndicator extends QuickSettings.SystemIndicator {
    _init() {
        super._init();

        // Create the icon for the indicator
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'video-display-symbolic';
        // Hide the indicator by default
        this._indicator.visible = false;
        this.graphic_toggle = new System76GraphicsQuickMenuToggle()
        // Create the toggle menu and associate it with the indicator
        this.quickSettingsItems.push(this.graphic_toggle);

        // Add the indicator to the panel and the toggle to the menu
        QuickSettingsMenu.addExternalIndicator(this);
    }

    destroy() {
        // Set enabled state to false to kill the service on destroy
        this.quickSettingsItems.forEach(item => item.destroy());
        // Destroy the indicator
        this._indicator.destroy();
        super.destroy();
    }
});
}

export class Ext {
    bus: GObj = new PowerDaemon(Gio.DBus.system, 'com.system76.PowerDaemon', '/com/system76/PowerDaemon');

    graphics_profiles: GraphicsProfiles | null = null;

    // For GNOME 45+ Quick Settings
    quickSettingsMenu: any = null;
    graphics_toggle: typeof System76GraphicsQuickMenuToggle = null;
    service_indicator: typeof ServiceIndicator = null;
    
    // For GNOME 43-44 Panel Indicator
    panel_indicator: any = null;
    power_menu: any = null;
    graphics_separator: GObj | null = null;

    switched: boolean = false;
    notified: boolean = false;

    constructor() {
        this.bus.set_default_timeout(300000);

        try {
            if (this.bus.GetSwitchableSync() == "true") {
                let ext_requires_nvidia: boolean = this.bus.GetExternalDisplaysRequireDgpuSync() == "true";
                let graphics: string = this.bus.GetGraphicsSync();
                log("graphics: " + graphics)
                log("canUseQuickSettings: " + canUseQuickSettings)


                // Create UI based on GNOME Shell version
                if (canUseQuickSettings) {
                    // GNOME 45+: Use Quick Settings
                    this.service_indicator = new ServiceIndicator();
                    this.graphics_toggle = this.service_indicator.graphic_toggle;
                } else {
                    // GNOME 43-44: Use Panel Indicator
                    this.panel_indicator = new PanelIndicator();
                    this.power_menu = this.panel_indicator.menu;
                    this.graphics_separator = new PopupMenu.PopupSeparatorMenuItem();
                    this.power_menu.addMenuItem(this.graphics_separator);
                }
                
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

        // Cleanup for GNOME 45+ Quick Settings
        if (this.graphics_toggle) {
            this.graphics_toggle.destroy();
            this.graphics_toggle = null;
        }

        // Cleanup for GNOME 43-44 Panel Indicator
        if (this.panel_indicator) {
            this.panel_indicator.destroy();
        }
        
        if (this.graphics_separator) {
            this.graphics_separator.destroy();
        }
    }

    attach_graphics_profile(name: string, text: string | null, profile: string) {
        let obj = new PopupGraphicsMenuItem(name + GRAPHICS, text);
        obj.setting = false;
        obj.connect('activate', (item: any) => {
            this.graphics_activate(item, name, profile);
        });
        
        // Add to appropriate menu based on GNOME version
        if (canUseQuickSettings && this.graphics_toggle) {
            this.graphics_toggle.menu.addMenuItem(obj);
        } else if (this.power_menu) {
            this.power_menu.addMenuItem(obj);
        }
        
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


