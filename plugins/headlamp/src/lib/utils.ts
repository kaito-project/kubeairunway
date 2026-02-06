/**
 * Utility functions for the Headlamp plugin
 */

/**
 * Ayna deep link configuration (unified flow)
 * URL Pattern: ayna://chat?model={model}&prompt={message}&system={system}&provider={provider}&endpoint={url}&key={apikey}&type={type}
 */
export interface AynaOptions {
  // Chat parameters
  model?: string;
  prompt?: string;
  system?: string;
  // Model setup parameters
  provider?: 'openai' | 'azure' | 'github' | 'aikit';
  endpoint?: string;
  key?: string;
  type?: 'chat' | 'responses' | 'image';
}

/**
 * Generate an Ayna deep link URL (unified flow for chat + model setup)
 * URL Pattern: ayna://chat?model={model}&prompt={message}&system={system}&provider={provider}&endpoint={url}&key={apikey}&type={type}
 */
export function generateAynaUrl(options: AynaOptions = {}): string {
  const params = new URLSearchParams();
  if (options.model) params.set('model', options.model);
  if (options.prompt) params.set('prompt', options.prompt);
  if (options.system) params.set('system', options.system);
  if (options.provider) params.set('provider', options.provider);
  if (options.endpoint) params.set('endpoint', options.endpoint);
  if (options.key) params.set('key', options.key);
  if (options.type) params.set('type', options.type);

  const queryString = params.toString();
  return `ayna://chat${queryString ? `?${queryString}` : ''}`;
}
