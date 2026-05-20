import type { ChorusAttachmentLabels } from './types';

export const DEFAULT_ATTACHMENT_LABELS: ChorusAttachmentLabels = {
  readingStatus: (name) => `Reading ${name}`,
  uploadingStatus: (name) => `Uploading ${name}`,
  completedAnnouncement: (name) => `${name} attached`,
  failedAnnouncement: (name) => `${name} failed to attach`,
  removeAttachment: (name) => `Remove ${name}`,
  cancelUpload: (name) => `Cancel upload of ${name}`,
  retry: 'Retry',
  retryAttachment: (name) => `Retry ${name}`,
  dismissError: 'Dismiss attachment error',
  describeImage: 'Describe this image',
  describeImageInputAriaLabel: (name) => `Description for ${name}`,
  describeImagePlaceholder: 'Describe this image (optional)',
  imageFallbackAlt: (name) => `Attached image: ${name}`,
  unsupportedTypeError: ({ name, accept }) =>
    `${name} is not an accepted attachment type${accept ? ` (${accept})` : ''}.`,
  tooLargeError: ({ name, size, limit }) =>
    `${name} is ${size}; the limit is ${limit}.`,
  tooManyError: ({ name, max }) =>
    `Only ${max} attachment${max === 1 ? '' : 's'} allowed. Remove an attachment before adding ${name}.`,
  readFailedError: ({ name, detail }) => `${name} could not be read: ${detail}`,
  uploadFailedError: ({ name, detail }) => `${name} could not be uploaded: ${detail}`,
};
