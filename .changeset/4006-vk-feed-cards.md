---
"@ds/schemas": minor
"@ds/design-system": minor
"@ds/api": minor
---

048 EARS-48…EARS-50: the public feed serves VK wall posts as `post` cards (`source.platform: "vk"`) and VK Видео videos as the new `video` card (`FeedVideoCardSchema`), with the referenced VK preview, the `vk.com` permalink and removed / hidden / switched-off entries absent; `FeedCard` draws the VK post and the VK Видео variants — chips «VK» / «VK▶», «VK ↗» / «VK Видео ↗», play mark and duration, the image sent with no referrer and the no-image layout when a preview fails to load.
