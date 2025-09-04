import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock server-only
vi.mock('server-only', () => ({}));
