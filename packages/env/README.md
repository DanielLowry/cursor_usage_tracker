# @cursor-usage/env

This package manages environment variables and configuration for the project.

## Usage

Configuration is loaded and validated from `process.env`. In development, it will also load variables from the root `.env` file.

```typescript
import { loadConfig } from '@cursor-usage/env';

const config = loadConfig();

console.log(config.NODE_ENV);
```