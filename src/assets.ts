/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineAssets } from '@iwsdk/core';

// Every texture, model and sound in FOLD is generated at runtime, so the
// manifest is intentionally empty and the app cold-starts with no downloads.
export default defineAssets({});
