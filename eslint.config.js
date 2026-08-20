import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'public/sw.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'prototype',
          message: 'Date 조작은 domain/date.ts 헬퍼를 사용하세요.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // `d.toISOString().slice(0, 10)` 형태가 v3의 실제 버그였습니다.
          // 전체 타임스탬프(exportedAt 등)에 toISOString()을 쓰는 것은 정상입니다.
          selector:
            "CallExpression[callee.object.callee.property.name='toISOString'][callee.property.name=/^(slice|substring|substr|split)$/]",
          message:
            'toISOString()을 잘라 날짜 키를 만들지 마세요. KST에서 하루 밀립니다. domain/date.ts의 toDateKey()/addDays()를 사용하세요.',
        },
      ],
    },
  },
)
