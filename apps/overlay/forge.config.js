module.exports = {
  packagerConfig: {
    name: 'WebHID Controller Overlay',
    executableName: 'webhid-controller-overlay',
    asar: true,
    icon: './src/assets/icon',
    extraResource: [],
  },
  makers: [
    // ── Windows: Squirrel installer (Setup.exe + auto-update support) ──
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'WebHIDControllerOverlay',
        setupExe: 'WebHID-Controller-Overlay-Setup.exe',
        setupIcon: './src/assets/icon.ico',
        iconUrl: 'https://raw.githubusercontent.com/UsersFirst/tandemonium-controller-lab/main/apps/overlay/src/assets/icon.ico',
        description: 'WebHID controller overlay for streamers',
      },
    },
    // ── Cross-platform: ZIP (portable — no install needed) ──
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
    // ── macOS: DMG with drag-to-Applications layout ──
    // Requires `appdmg` (native module) — install separately or use the
    // scripts/make-dmg.sh helper which uses hdiutil directly.
    // Uncomment when appdmg builds on your system:
    // {
    //   name: '@electron-forge/maker-dmg',
    //   config: {
    //     format: 'ULFO',
    //     icon: './src/assets/icon.icns',
    //     contents: [
    //       { x: 130, y: 220, type: 'file', path: '' },
    //       { x: 410, y: 220, type: 'link', path: '/Applications' },
    //     ],
    //     window: { size: { width: 540, height: 380 } },
    //   },
    // },
  ],
  plugins: [
    // #106: node-hid is a native module — unpack its .node binary out of the
    // asar archive so it's loadable at runtime. Forge's package/make step also
    // rebuilds native modules for the target Electron ABI via @electron/rebuild.
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
  ],
};
