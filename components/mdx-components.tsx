import type { MDXComponents } from 'mdx/types';
import defaultComponents from 'fumadocs-ui/mdx';

export function getMDXComponents(): MDXComponents {
  return {
    ...defaultComponents,
  };
}
