# Chrome Web Store: Privacy tab (FullShot)

Paste-ready answers for the **Privacy** tab of the Chrome Web Store Developer Dashboard. The
answers match the shipped code and [`PRIVACY.md`](../PRIVACY.md). Keep the three consistent: the
store can remove an item when the dashboard, the privacy policy and the code do not agree.

Facts from the code that the answers depend on:

- FullShot makes no network requests. It has no server, no analytics and no remote code.
- It reads a page only after the user starts a capture (`activeTab`), and only the pixels it
  captures, plus the page address and title.
- A capture opened in the editor is kept in IndexedDB with the page address, the page title and
  the capture time (`src/lib/db.ts`). FullShot keeps the 10 newest and deletes older ones.
- The two options (JPEG/PDF quality, PDF stamp) are in `chrome.storage.sync`. If the user turns on
  Chrome sync, Chrome copies them to the user's other browsers. The developer never gets them.

## Single purpose

```text
FullShot takes a screenshot of the current web page (the full page, the visible area or an area the user selects), lets the user mark it up, and saves it as a PNG, JPEG or PDF file on the user's device. Capturing, marking up and saving screenshots is its only purpose.
```

## Permission justification

**activeTab**

```text
FullShot captures the tab on which the user clicks its toolbar button or presses one of its keyboard shortcuts. activeTab gives it temporary access to that one tab, only after that user action. FullShot uses the access to call chrome.tabs.captureVisibleTab and to run its capture script in the tab. It requests no host permissions, so it has no access to any site before the user acts.
```

**scripting**

```text
After the user starts a capture, FullShot runs a function from its own package in the active tab with chrome.scripting.executeScript. For a full-page capture, the function measures the page, scrolls it one screen at a time and hides fixed headers after the first screen, so the screens join into one image. After the capture it puts the page back as it was. For an area capture, it shows the selection rectangle. No content script is registered, and no code comes from outside the package.
```

**storage**

```text
FullShot keeps two user options with chrome.storage: the JPEG/PDF quality and whether to stamp the page address and date on PDF pages. It stores nothing else there.
```

**unlimitedStorage**

```text
A full-page screenshot can be tens of megabytes. To open a capture in the editor, the background service worker writes the image to the extension's IndexedDB and the editor tab reads it. unlimitedStorage stops large captures from failing on the default storage quota. FullShot keeps only the 10 newest captures and deletes older ones automatically. The images stay on the user's device.
```

**downloads**

```text
FullShot uses chrome.downloads to save the finished PNG, JPEG or PDF file to the user's Downloads folder when the user clicks an export button. It uses it for nothing else.
```

The dashboard shows no host-permission field, because FullShot requests none.

## Remote code

Select **No, I am not using remote code**.

The package contains all of FullShot's code. The build removes a CDN script address that jsPDF
keeps for a feature FullShot does not use (see `vite.config.ts`), and `npm run package:chrome`
stops if a script URL remains.

## Data usage

### What user data do you plan to collect from users now or in the future?

The Chrome Web Store User Data FAQ lists "taking screenshots or capturing data from a web page" as
handling user data, even when the data stays on the device (questions 2 and 14). So disclose what
FullShot handles:

| Data type | Select | Reason |
| --- | --- | --- |
| Personally identifiable information | No | FullShot does not read or ask for names, addresses, emails or IDs. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | |
| Personal communications | No | |
| Location | No | |
| Web history | **Yes** | Each capture opened in the editor is kept with the page address, page title and capture time. The address gives the file name and the optional PDF stamp. |
| User activity | No | No clicks, keystrokes or usage data are recorded. |
| Website content | **Yes** | The screenshot is an image of the page content. |

Selecting a type does not say that the data leaves the device. The privacy policy explains that it
does not. If you think that storing data only on the device is not "collecting", you can leave all
types unselected; the store then shows that FullShot collects no data. The two selections above are
the safer choice, because the review rejects items that handle data they did not disclose.

### Certifications (select all three)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single
      purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

All three are true: FullShot sends no data to anyone.

## Privacy policy URL

```text
https://github.com/Penguin-Pants/FullShot/blob/main/PRIVACY.md
```

The link works only while the repository is public. The policy includes the Limited Use statement
that the User Data Policy asks for.
