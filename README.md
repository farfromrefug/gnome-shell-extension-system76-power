# System76 Power Management

**[gnome-shell-extension-system76-power](https://github.com/pop-os/gnome-shell-extension-system76-power)** is a GNOME Shell extension that adds graphical integration with the [system76-power](https://github.com/pop-os/system76-power) daemon, including:

- Graphics-switching profiles (on applicable systems) integrated into the GNOME Quick Settings panel
- Prompting to switch graphics modes when necessary to use a hot-plugged display

_This is a fork that supports Gnome v45+ and integrates graphics switching into the Quick Settings panel (Control Center) instead of using a separate panel icon._

### Requirements
- `git` (or `unzip`) and Typescript (`tsc`)

### Installation
- Latest version: clone repo and `cd` into it
- Older versions: download the source from [Releases](https://gitlab.com/LFd3v/gnome-shell-extension-system76-power/-/releases), uncompress and `cd` into it
- run `make all && make install`

Please look at [Makefile](./Makefile) for more info and other options.

![Screenshots](./assets/screenshots_v43.webp)
