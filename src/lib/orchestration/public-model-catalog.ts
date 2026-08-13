// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Produced by scripts/generate-public-catalog.ts from the canonical model
// registry. Run `npm run catalog:generate` after changing a model's
// capabilities; src/test/e2e/phase-7-routing.e2e.test.ts fails if this file
// and the registry disagree.
//
// Contains capabilities only. No provider id, no provider endpoint, no route,
// no priority, no cost — the browser has no business knowing where a
// generation runs.

import type { PublicModelDescriptor } from "./capability-projection";

export const PUBLIC_MODEL_CATALOG: readonly PublicModelDescriptor[] = [
  {
    "id": "cloudflare-aura-2-en",
    "label": "Aura-2 English (Cloudflare Workers AI)",
    "generationType": "audio",
    "supportedWorkflows": [
      "text-to-speech"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": false,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "4:5",
        "5:4",
        "2:3",
        "3:2"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "audioFormats": [
        "audio/mpeg"
      ],
      "languages": [
        "en"
      ],
      "voices": [
        "amalthea",
        "andromeda",
        "apollo",
        "arcas",
        "aries",
        "asteria",
        "athena",
        "atlas",
        "aurora",
        "callista",
        "cora",
        "cordelia",
        "delia",
        "draco",
        "electra",
        "harmonia",
        "helena",
        "hera",
        "hermes",
        "hyperion",
        "iris",
        "janus",
        "juno",
        "jupiter",
        "luna",
        "mars",
        "minerva",
        "neptune",
        "odysseus",
        "ophelia",
        "orion",
        "orpheus",
        "pandora",
        "phoebe",
        "pluto",
        "saturn",
        "thalia",
        "theia",
        "vesta",
        "zeus"
      ],
      "requiresVoice": false
    },
    "defaults": {
      "outputCount": 1
    }
  },
  {
    "id": "cloudflare-melotts",
    "label": "MeloTTS (Cloudflare Workers AI)",
    "generationType": "audio",
    "supportedWorkflows": [
      "text-to-speech"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": false,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "4:5",
        "5:4",
        "2:3",
        "3:2"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "audioFormats": [
        "audio/mpeg"
      ],
      "requiresVoice": false
    },
    "defaults": {
      "outputCount": 1
    }
  },
  {
    "id": "fal-flux-dev",
    "label": "FLUX.1 [dev] (fal.ai)",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 4,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "16:9",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "fal-flux-schnell",
    "label": "FLUX.1 [schnell] (fal.ai)",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 4,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "16:9",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "fal-nano-banana",
    "label": "Nano Banana (fal.ai)",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "4:5",
        "5:4",
        "2:3",
        "3:2"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 4,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "1:1",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "fal-nano-banana-2",
    "label": "Nano Banana 2 (fal.ai)",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "Auto",
        "1:1",
        "3:4",
        "9:16",
        "4:3",
        "16:9",
        "21:9"
      ],
      "resolutions": [
        "0.5K",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 4,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "3:4",
      "resolution": "2K",
      "outputCount": 1
    }
  },
  {
    "id": "fal-recraft-v3",
    "label": "Recraft V3 (fal.ai)",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "1:1",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "fal-seedream-v4",
    "label": "Seedream 4.0 (fal.ai)",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 4,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "16:9",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "fal-z-image-turbo",
    "label": "Z-Image Turbo (fal.ai)",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": false,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 4,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "16:9",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "mock-image",
    "label": "Cinefield Mock Image",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": true,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "4:5",
        "5:4",
        "2:3",
        "3:2"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 10,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "16:9",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "mock-image-edit",
    "label": "Cinefield Mock Image Edit",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image",
      "image-to-image"
    ],
    "acceptedInputMimeTypes": [
      "image/jpeg",
      "image/png",
      "image/webp"
    ],
    "maxInputs": 2,
    "isMock": true,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "4:5",
        "5:4",
        "2:3",
        "3:2"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 2,
      "supportsThinking": true,
      "thinkingValues": [
        "High",
        "Minimal"
      ],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "1:1",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "mock-tts",
    "label": "Cinefield Mock TTS",
    "generationType": "audio",
    "supportedWorkflows": [
      "text-to-speech"
    ],
    "acceptedInputMimeTypes": [],
    "maxInputs": 0,
    "isMock": true,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "4:5",
        "5:4",
        "2:3",
        "3:2"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 5000,
      "audioFormats": [
        "audio/wav"
      ],
      "languages": [
        "any"
      ],
      "requiresVoice": false,
      "maxAudioDurationSeconds": 300
    },
    "defaults": {
      "outputCount": 1
    }
  },
  {
    "id": "mock-video",
    "label": "Cinefield Mock Video",
    "generationType": "video",
    "supportedWorkflows": [
      "text-to-video",
      "image-to-video"
    ],
    "acceptedInputMimeTypes": [
      "image/jpeg",
      "image/png",
      "image/webp"
    ],
    "maxInputs": 1,
    "isMock": true,
    "productionReady": true,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "21:9",
        "4:5",
        "5:4",
        "2:3",
        "3:2"
      ],
      "resolutions": [
        "512p",
        "720p",
        "768p",
        "1080p",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [
        4,
        6,
        8,
        10
      ],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "16:9",
      "resolution": "720p",
      "durationSeconds": 8,
      "outputCount": 1
    }
  },
  {
    "id": "nano-banana-2",
    "label": "Nano Banana 2",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image",
      "image-to-image"
    ],
    "acceptedInputMimeTypes": [
      "image/jpeg",
      "image/png",
      "image/webp"
    ],
    "maxInputs": 1,
    "isMock": false,
    "productionReady": false,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9"
      ],
      "resolutions": [
        "512",
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": true,
      "thinkingValues": [
        "low",
        "medium",
        "high"
      ],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "1:1",
      "resolution": "512",
      "outputCount": 1
    }
  },
  {
    "id": "nano-banana-2-lite",
    "label": "Nano Banana 2 Lite",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image",
      "image-to-image"
    ],
    "acceptedInputMimeTypes": [
      "image/jpeg",
      "image/png",
      "image/webp"
    ],
    "maxInputs": 1,
    "isMock": false,
    "productionReady": false,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9"
      ],
      "resolutions": [
        "1K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "1:1",
      "resolution": "1K",
      "outputCount": 1
    }
  },
  {
    "id": "nano-banana-pro",
    "label": "Nano Banana Pro",
    "generationType": "image",
    "supportedWorkflows": [
      "text-to-image",
      "image-to-image"
    ],
    "acceptedInputMimeTypes": [
      "image/jpeg",
      "image/png",
      "image/webp"
    ],
    "maxInputs": 1,
    "isMock": false,
    "productionReady": false,
    "capabilities": {
      "aspectRatios": [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9"
      ],
      "resolutions": [
        "1K",
        "2K",
        "4K"
      ],
      "durationsSeconds": [],
      "minOutputCount": 1,
      "maxOutputCount": 1,
      "supportsThinking": false,
      "thinkingValues": [],
      "requiresPrompt": true,
      "maxPromptLength": 10000
    },
    "defaults": {
      "aspectRatio": "1:1",
      "resolution": "1K",
      "outputCount": 1
    }
  }
] as const;
