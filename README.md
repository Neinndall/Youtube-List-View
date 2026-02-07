# Youtube List View

**Youtube List View** is a browser extension designed to enhance your YouTube Subscriptions experience by allowing you to toggle between the default grid layout and a professional, clean list view.

## 🚀 Features

- **Dynamic Toggle**: Easily switch between Grid and List views directly from the Subscriptions page header.
- **Smart Descriptions**: Automatically fetches and summarizes video descriptions to give you more context without leaving the page.
- **Persistent Preferences**: Saves your preferred view mode and applies it automatically on every visit.
- **Advanced Caching**: Implements a high-performance local cache for video descriptions with TTL (Time To Live) logic to minimize network requests.
- **Modern UI/UX**:
    - Clean row-based layout for videos.
    - Integrated channel headers with avatars and names.
    - Skeleton screens with shimmer animations for a "content-first" loading experience.
    - Full support for both **Light** and **Dark** themes.
- **Optimized Performance**: Uses `MutationObserver` and asynchronous processing queues (`requestIdleCallback`) to ensure a smooth scrolling experience even with thousands of subscriptions.

## 🛠️ How It Works

The extension works by injecting a lightweight content script that observes changes in the YouTube DOM. When the List view is active, it:
1.  **Re-layouts the Grid**: Transforms the standard `ytd-rich-grid-renderer` into a vertical list using optimized CSS variables.
2.  **Enriches Metadata**: Moves channel information and video details into a more readable horizontal format.
3.  **Fetches Content**: Periodically scans visible videos and fetches their short descriptions directly from YouTube's internal data structures, ensuring zero impact on your browser's speed.

## 📦 Installation

1.  Download or clone this repository.
2.  Open your browser and navigate to `chrome://extensions/` (or equivalent for your browser).
3.  Enable **Developer mode** in the top right corner.
4.  Click on **Load unpacked** and select the project folder.
5.  Go to your [YouTube Subscriptions](https://www.youtube.com/feed/subscriptions) and enjoy the new view!

## 🔧 Technologies Used

- **JavaScript (ES6+)**: Core logic and DOM manipulation.
- **CSS3**: Advanced grid layouts, custom properties (variables), and animations.
- **Chrome Extension API (Manifest V3)**: Storage and content script management.
- **Intl.Segmenter**: For smart, multi-language sentence summarizing.

---

*Made with ❤️ to make your YouTube browsing better.*
