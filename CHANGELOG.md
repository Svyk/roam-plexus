# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0]

- Region kinds: group, frame, cframe (exact frame), poly, imgrect, imgpoly. "Frame (with margin)" toolbar button.
- Image regions: rect and Alt-lasso polygon crops on images inside drawings, plus a "Plexus: Region on image" block context menu command.
- Drawing links: clicking a Roam link on a drawing element opens the page or block (Shift opens in the sidebar); hover preview of the link target.
- Thumbnails via `actions.thumbnail` and a frozen `window.RoamPlexus` API (create, open, drawingsOn, thumbnail, change events).

### 0.1.0

- Scaffold from roam-extension-template.
- Region refs for native Excalidraw drawings (area and image-rect regions), cropped rendering, click to open zoomed with spotlight.
