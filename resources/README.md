# App Icon & Splash Screen Source Files

`@capacitor/assets` reads three source images from this folder and generates every iOS icon and splash screen size automatically.

## Required files

Drop these in `resources/` (this folder), all PNG, no transparency on splash backgrounds:

| File | Size | Purpose |
| --- | --- | --- |
| `icon.png` | 1024×1024 | App icon. Centered logo on solid background. iOS will round the corners. |
| `splash.png` | 2732×2732 | Splash screen, light mode. Logo centered on solid background. |
| `splash-dark.png` | 2732×2732 | Splash screen, dark mode. |

## Generate

```bash
npm run ios:assets
```

This populates `ios/App/App/Assets.xcassets/AppIcon.appiconset/` and `Splash.imageset/` with all required sizes.

## Until real artwork exists

If the files above are missing, the iOS project will use Capacitor's default placeholder icon and a solid `#0f0f10` splash (configured in `capacitor.config.ts`). The app will still build and run.
