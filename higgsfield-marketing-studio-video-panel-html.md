# Higgsfield Marketing Studio Video Panel HTML Reference

Source: `https://higgsfield.ai/marketing-studio`

Section inspected: Marketing Studio -> Video

Target comparison page: `https://cinefield-ai.vercel.app/marketing-studio/product`

## Closed Prompt Row

Discovered order:

1. `Add reference`
2. `Marketing Studio Video`
3. `Choose style` -> selected label `2D product motion`
4. `Aspect ratio` -> selected label `9:16`
5. Resolution combobox
6. `Duration` -> selected label `5s`
7. Batch controls -> `Decrease batch size`, `1/4`, `Increase batch size`
8. `Product` upload slot
9. `Generate campaign`

Representative accessible DOM:

```text
tab [selected]: Video
textbox: Describe the scene you imagine...
button: Add reference
button: Marketing Studio Video
button: Choose style
  generic: 2D product motion
button: Aspect ratio: 9:16
combobox
button: 5s
button: Decrease batch size [disabled]
generic: 1/4
button: Increase batch size
button: Product
  button: Add Product
  paragraph: Product
button: Generate campaign [disabled]
```

## Model Selector

Opened from `Marketing Studio Video`.

Panel structure:

```text
dialog
  textbox: Search...
  paragraph: Featured models
  model rows
  paragraph: All models
  model rows
```

Featured models discovered:

| Model | Badges | Meta |
| --- | --- | --- |
| Marketing Studio Video | New | 720p-2K, 5s-30s |
| Seedance 2.5 | Exclusive access | 1080p, 4s-30s |
| Seedance 2.5 Edit | New | 480p-720p, Edit Video, Audio |
| Seedance 2.0 |  | 4K, 4s-15s |
| Seedance 2.0 Fast |  | 720p, 4s-15s |
| Seedance 2.0 Mini |  | 720p, 4s-15s |
| MiniMax H3 | New | 2K, 5s-15s |
| Gemini Omni Flash |  | 720p, 4s-10s |
| Kling 3.0 |  | 4K, 3s-15s |
| Kling 3.0 Motion Control |  | 1080p, 3s-30s |
| FLUX.3 Video | New | 1080p, 5s-20s |
| Grok Imagine 1.5 |  | 720p, 1s-15s |

All models discovered:

```text
Minimax Hailuo
FLUX.3 Video
Kling
OpenAI Sora 2
Google Veo
Gemini Omni Flash
Higgsfield
Wan
Seedance
Grok Imagine
HappyHorse
```

Implementation note: `Higgsfield` is rendered as `Cinefield` in Cinefield.

## Choose Style Dialog

Opened from `Choose style`.

Structure:

```text
dialog: Choose style
  header: Choose style
  button: Close
  navigation: Marketing Studio categories
    Image
      Product shot
      Ads
      Marketplace
    Video
      Motion [pressed]
  section: Motion
  searchbox: Search styles
  radiogroup: Styles
```

Style options discovered:

```text
2D product motion [checked]
Hypermotion
Typography
Dark Minimalism
Color pop
Mixed media
SaaS
```

## Other Opened Controls

`Add reference` opens the Assets dialog:

```text
dialog: Assets
  heading: Assets
  tabs/buttons:
    Uploads
    Image Generations
    Liked
    Products
  button: Close assets picker
  button: Filter
  Upload file
  No uploads found
```

`Duration` opens a duration panel:

```text
dialog
  generic: Duration
  generic: 5s
  slider: Duration
```

## Cinefield Replacement Rules

Removed `/generate`-derived default from Marketing Studio Video:

```text
Cinema Studio 3.5
generic /generate video model hierarchy
@ mention button in Video mode
universal image-style count dropdown in Video mode
```

Added Marketing Studio Video structure:

```text
Marketing Studio Video model selector
Choose style trigger and dialog
Marketing Studio Video model inventory
Video-specific defaults: 9:16, 2K, 5s, 1/4
Product upload slot beside Generate
```
