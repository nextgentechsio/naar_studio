type Input = Record<string, unknown>;

// Loose on purpose: it's whatever Replicate (or the cost
// preview) hands us, so every field is checked before use
type Prediction = {
  status?: unknown;
  input?: Input;
  output?: unknown;
  logs?: unknown;

  metrics?: {
    predict_time?: unknown;
    total_time?: unknown;
    cost?: unknown;
  };

  costUsd?: unknown;
  cost?: unknown;
};

/* =========================================================
   MODEL IDS
========================================================= */

export const MODEL_IDS = {
  NANO_BANANA: "google/nano-banana",

  NANO_BANANA_2:
    "google/nano-banana-2",

  NANO_BANANA_PRO:
    "google/nano-banana-pro",

  CRYSTAL_UPSCALER:
    "philz1337x/crystal-upscaler",

  KLING_V3_OMNI:
    "kwaivgi/kling-v3-omni-video",

  SEEDANCE_2:
    "bytedance/seedance-2.0",

  SEEDANCE_25:
    "bytedance/seedance-2.5",

  TOPAZ_IMAGE:
    "topazlabs/image-upscale",

  TOPAZ_VIDEO:
    "topazlabs/video-upscale",

  GPT_IMAGE_25_SUNBURST:
    "openai/gpt-image-2.5-sunburst",
} as const;


/* =========================================================
   HELPERS
========================================================= */

// Real numbers and numeric strings only: Number(null),
// Number("") and Number(false) are 0, which would turn
// "no value" into a $0 price or a zero duration.
function numberValue(
  value: unknown,
  fallback = 0
): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  return fallback;
}


function lower(
  value: unknown
): string {
  return String(
    value ?? ""
  )
    .trim()
    .toLowerCase();
}


function getInput(
  prediction: Prediction
): Input {
  return (
    prediction?.input ?? {}
  );
}


function getResolution(
  input: Input,
  fallback = ""
): string {
  return lower(
    input.resolution ??
      input.target_resolution ??
      input.output_resolution ??
      input.size ??
      fallback
  );
}


// A missing or non-positive duration is treated like
// the model default, so a price is never negative
function getDuration(
  input: Input,
  fallback = 5
): number {
  const duration = numberValue(
    input.duration ??
      input.video_duration ??
      input.output_duration,
    fallback
  );

  return duration > 0 ? duration : fallback;
}


// Seedance takes `reference_videos` (a list); an empty
// list means no video input
function hasVideoInput(
  input: Input
): boolean {
  const present = (value: unknown) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value);

  return [
    input.video,
    input.video_input,
    input.reference_video,
    input.reference_videos,
    input.video_url,
  ].some(present);
}


function getQuality(
  input: Input
): string {
  return lower(
    input.quality ??
      input.output_quality ??
      input.image_quality ??
      "auto"
  );
}


/* =========================================================
   GET OUTPUT MEGAPIXELS

   Used by:
   - Crystal Upscaler
   - Topaz Image
========================================================= */

function getOutputMegapixels(
  prediction: Prediction
): number {
  const input =
    getInput(prediction);

  /* -----------------------------------------
     Direct MP value
  ----------------------------------------- */

  const mp =
    numberValue(
      input.output_megapixels ??
        input.megapixels ??
        input.output_mp
    );

  if (mp > 0) {
    return mp;
  }


  /* -----------------------------------------
     Width × Height
  ----------------------------------------- */

  const width =
    numberValue(
      input.output_width ??
        input.width
    );

  const height =
    numberValue(
      input.output_height ??
        input.height
    );

  if (
    width > 0 &&
    height > 0
  ) {
    return (
      (width * height) /
      1_000_000
    );
  }


  /* -----------------------------------------
     Parse model logs

     Example:
     New upscaled resolution:
     1980x2466
  ----------------------------------------- */

  const logs =
    String(
      prediction.logs ?? ""
    );

  const resolutionMatch =
    logs.match(
      /(?:new upscaled resolution|upscaled resolution|output resolution)[^0-9]*(\d{2,6})\s*[x×]\s*(\d{2,6})/i
    );

  if (resolutionMatch) {
    const logWidth =
      Number(
        resolutionMatch[1]
      );

    const logHeight =
      Number(
        resolutionMatch[2]
      );

    if (
      logWidth > 0 &&
      logHeight > 0
    ) {
      return (
        (logWidth * logHeight) /
        1_000_000
      );
    }
  }


  /* -----------------------------------------
     Original dimensions × scale
  ----------------------------------------- */

  const originalWidth =
    numberValue(
      input.original_width
    );

  const originalHeight =
    numberValue(
      input.original_height
    );

  const scale =
    numberValue(
      input.scale_factor,
      2
    );

  if (
    originalWidth > 0 &&
    originalHeight > 0 &&
    scale > 0
  ) {
    return (
      (
        originalWidth *
        originalHeight *
        scale *
        scale
      ) /
      1_000_000
    );
  }


  return 0;
}


/* =========================================================
   DIRECT COST

   If Replicate/provider ever sends an exact cost,
   use that first.
========================================================= */

function getDirectCost(
  prediction: Prediction
): number | null {

  const candidates = [
    prediction?.costUsd,
    prediction?.cost,
    prediction?.metrics?.cost,
  ];

  for (
    const value of candidates
  ) {
    const cost =
      numberValue(
        value,
        -1
      );

    if (
      cost >= 0
    ) {
      return cost;
    }
  }

  return null;
}


/* =========================================================
   MAIN COST CALCULATOR
========================================================= */

// Prices are rounded to 1/10,000 of a cent, so per-second
// maths (5 × 0.168 = 0.8400000000000001) doesn't leak
// float noise into the ledger and its totals.
export function calculateReplicateCost(
  model: string,
  prediction: Prediction
): number | null {
  const cost = computeReplicateCost(model, prediction);

  return cost === null
    ? null
    : Math.round(cost * 1_000_000) / 1_000_000;
}

function computeReplicateCost(
  model: string,
  prediction: Prediction
): number | null {

  if (!prediction) {
    return null;
  }


  /* -----------------------------------------
     Direct provider cost
  ----------------------------------------- */

  const directCost =
    getDirectCost(
      prediction
    );

  if (
    directCost !== null
  ) {
    return directCost;
  }


  /* -----------------------------------------
     Only completed predictions
  ----------------------------------------- */

  const status =
    lower(
      prediction.status
    );

  if (
    status !== "succeeded"
  ) {
    return null;
  }


  const input =
    getInput(
      prediction
    );

  const normalizedModel =
    lower(model);


/* =========================================================
   1. GOOGLE NANO BANANA
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.NANO_BANANA
  ) {

    /*
      Current Replicate price:

      $0.039 / output image
    */

    return 0.039;
  }


/* =========================================================
   2. GOOGLE NANO BANANA 2
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.NANO_BANANA_2
  ) {

    /*
      512px = $0.045
      1K    = $0.067
      2K    = $0.101
      4K    = $0.151
    */

    const resolution =
      getResolution(
        input,
        "1K"
      );


    if (
      resolution.includes(
        "512"
      )
    ) {
      return 0.045;
    }


    if (
      resolution.includes(
        "4k"
      )
    ) {
      return 0.151;
    }


    if (
      resolution.includes(
        "2k"
      )
    ) {
      return 0.101;
    }


    return 0.067;
  }


/* =========================================================
   3. GOOGLE NANO BANANA PRO
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.NANO_BANANA_PRO
  ) {

    /*
      1K       = $0.15
      2K       = $0.15
      4K       = $0.30
      fallback = $0.035
    */

    const resolution =
      getResolution(
        input,
        "2K"
      );


    if (
      resolution.includes(
        "fallback"
      )
    ) {
      return 0.035;
    }


    if (
      resolution.includes(
        "4k"
      )
    ) {
      return 0.30;
    }


    return 0.15;
  }


/* =========================================================
   4. CRYSTAL UPSCALER
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.CRYSTAL_UPSCALER
  ) {

    /*
      <= 4 MP     = $0.05
      <= 8 MP     = $0.10
      <= 16 MP    = $0.20
      <= 25 MP    = $0.40
      <= 50 MP    = $0.80
      <= 100 MP   = $1.60
      > 100 MP    = $3.20
    */

    const mp =
      getOutputMegapixels(
        prediction
      );


    /*
      Don't invent a price if the
      output size is genuinely unknown.
    */

    if (
      mp <= 0
    ) {
      return null;
    }


    if (
      mp <= 4
    ) {
      return 0.05;
    }


    if (
      mp <= 8
    ) {
      return 0.10;
    }


    if (
      mp <= 16
    ) {
      return 0.20;
    }


    if (
      mp <= 25
    ) {
      return 0.40;
    }


    if (
      mp <= 50
    ) {
      return 0.80;
    }


    if (
      mp <= 100
    ) {
      return 1.60;
    }


    return 3.20;
  }


/* =========================================================
   5. KLING V3 OMNI VIDEO
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.KLING_V3_OMNI
  ) {

    /*
      Standard no audio = $0.168/sec
      Standard audio    = $0.224/sec

      Pro no audio      = $0.224/sec
      Pro audio         = $0.28/sec

      4K                 = $0.42/sec
    */

    const duration =
      getDuration(
        input,
        5
      );


    // The model's own default is "pro"
    const mode =
      lower(
        input.mode ??
          "pro"
      );


    const resolution =
      getResolution(
        input
      );


    const audio =
      Boolean(
        input.generate_audio ??
          input.audio
      );


    /*
      4K
    */

    if (
      mode.includes("4k") ||
      resolution.includes("4k") ||
      mode === "fourk"
    ) {
      return (
        duration *
        0.42
      );
    }


    /*
      Pro / 1080
    */

    if (
      mode === "pro" ||
      mode.includes("1080")
    ) {

      return (
        duration *
        (
          audio
            ? 0.28
            : 0.224
        )
      );
    }


    /*
      Standard
    */

    return (
      duration *
      (
        audio
          ? 0.224
          : 0.168
      )
    );
  }


/* =========================================================
   6. SEEDANCE 2.0
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.SEEDANCE_2
  ) {

    /*
      480p:
        video input    = $0.10/sec
        no video input = $0.08/sec

      720p:
        video input    = $0.22/sec
        no video input = $0.18/sec

      1080p:
        video input    = $0.55/sec
        no video input = $0.45/sec

      4K:
        video input    = $1.25/sec
        no video input = $1.00/sec
    */

    const duration =
      getDuration(
        input,
        5
      );


    const resolution =
      getResolution(
        input,
        "720p"
      );


    const videoIn =
      hasVideoInput(
        input
      );


    let rate: number;


    if (
      resolution.includes(
        "480"
      )
    ) {

      rate =
        videoIn
          ? 0.10
          : 0.08;

    } else if (
      resolution.includes(
        "1080"
      )
    ) {

      rate =
        videoIn
          ? 0.55
          : 0.45;

    } else if (
      resolution.includes(
        "4k"
      ) ||
      resolution.includes(
        "2160"
      )
    ) {

      rate =
        videoIn
          ? 1.25
          : 1.00;

    } else {

      rate =
        videoIn
          ? 0.22
          : 0.18;
    }


    return (
      duration *
      rate
    );
  }


/* =========================================================
   7. SEEDANCE 2.5
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.SEEDANCE_25
  ) {

    /*
      480p:
        video input    = $0.4304/sec
        no video input = $0.1028/sec

      720p:
        video input    = $0.9676/sec
        no video input = $0.2312/sec
    */

    const duration =
      getDuration(
        input,
        5
      );


    const resolution =
      getResolution(
        input,
        "720p"
      );


    const videoIn =
      hasVideoInput(
        input
      );


    if (
      resolution.includes(
        "480"
      )
    ) {

      return (
        duration *
        (
          videoIn
            ? 0.4304
            : 0.1028
        )
      );
    }


    if (
      resolution.includes(
        "720"
      )
    ) {

      return (
        duration *
        (
          videoIn
            ? 0.9676
            : 0.2312
        )
      );
    }


    /*
      Replicate currently publishes
      480p / 720p pricing here.

      Don't invent a 1080p / 4K rate.
    */

    return null;
  }


/* =========================================================
   8. TOPAZ IMAGE
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.TOPAZ_IMAGE
  ) {

    /*
      <= 24 MP  = $0.05
      <= 48 MP  = $0.10
      <= 60 MP  = $0.15
      <= 96 MP  = $0.20
      <= 132 MP = $0.24
      <= 168 MP = $0.29
      <= 336 MP = $0.53
      <= 512 MP = $0.82
    */

    const mp =
      getOutputMegapixels(
        prediction
      );


    if (
      mp <= 0
    ) {
      return null;
    }


    if (
      mp <= 24
    ) {
      return 0.05;
    }


    if (
      mp <= 48
    ) {
      return 0.10;
    }


    if (
      mp <= 60
    ) {
      return 0.15;
    }


    if (
      mp <= 96
    ) {
      return 0.20;
    }


    if (
      mp <= 132
    ) {
      return 0.24;
    }


    if (
      mp <= 168
    ) {
      return 0.29;
    }


    if (
      mp <= 336
    ) {
      return 0.53;
    }


    return 0.82;
  }


/* =========================================================
   9. TOPAZ VIDEO
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.TOPAZ_VIDEO
  ) {

    /*
      Published reference costs:

      720p -> 720p
      30fps = $0.027 / 5 sec
      60fps = $0.053 / 5 sec

      720p -> 1080p
      30fps = $0.093 / 5 sec
      60fps = $0.187 / 5 sec

      720p -> 4K
      30fps = $0.373 / 5 sec
      60fps = $0.747 / 5 sec
    */

    /*
      The input is a video file, so its length isn't in
      the inputs. Without a known duration, don't guess
      (assuming 5s under-reported a 60s upscale 12x).
    */

    const duration = numberValue(
      input.duration ??
        input.video_duration ??
        input.output_duration,
      0
    );

    if (duration <= 0) {
      return null;
    }


    const fps =
      numberValue(
        input.target_fps,
        30
      );


    const resolution =
      getResolution(
        input,
        "1080p"
      );


    let costPer5Seconds: number;


    /*
      720p
    */

    if (
      resolution.includes(
        "720"
      )
    ) {

      costPer5Seconds =
        fps > 30
          ? 0.053
          : 0.027;


    /*
      4K
    */

    } else if (
      resolution.includes(
        "4k"
      ) ||
      resolution.includes(
        "2160"
      )
    ) {

      costPer5Seconds =
        fps > 30
          ? 0.747
          : 0.373;


    /*
      1080p
    */

    } else {

      costPer5Seconds =
        fps > 30
          ? 0.187
          : 0.093;
    }


    return (
      costPer5Seconds *
      (duration / 5)
    );
  }


/* =========================================================
   10. GPT IMAGE 2.5 SUNBURST
========================================================= */

  if (
    normalizedModel ===
    MODEL_IDS.GPT_IMAGE_25_SUNBURST
  ) {

    /*
      Replicate model-variant pricing:

      auto   = $0.25
      low    = $0.012
      medium = $0.047
      high   = $0.128
      xhigh  = $0.25
      max    = $0.50
    */

    const quality =
      getQuality(
        input
      );

    // Priced per image: up to 10 per run. Count what came
    // back when we know, else what was asked for.
    const returned = Array.isArray(prediction.output)
      ? prediction.output.length
      : 0;
    const images =
      returned > 0
        ? returned
        : Math.max(1, Math.floor(numberValue(input.number_of_images, 1)));

    return images * gptImagePrice(quality);
  }


/* =========================================================
   UNKNOWN MODEL
========================================================= */

  /*
    Never fake a price.
  */

  return null;
}

// GPT Image 2.5 price per image, by quality variant
const GPT_IMAGE_PRICES: Record<string, number> = {
  low: 0.012,
  medium: 0.047,
  high: 0.128,
  xhigh: 0.25,
  max: 0.5,
  // Replicate's "auto" variant
  auto: 0.25,
};

function gptImagePrice(quality: string): number {
  return GPT_IMAGE_PRICES[quality] ?? GPT_IMAGE_PRICES.auto;
}
