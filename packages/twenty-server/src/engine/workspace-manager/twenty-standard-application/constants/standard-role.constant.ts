export const STANDARD_ROLE = {
  admin: { universalIdentifier: '20202020-02c2-43f2-b94d-cab1f2b532eb' },
  standardApplication: {
    universalIdentifier: '20202020-7b75-4539-a822-e5d5dd69b18b',
  },
} as const satisfies Record<string, { universalIdentifier: string }>;
