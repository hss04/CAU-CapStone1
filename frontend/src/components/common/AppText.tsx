import { Children, isValidElement, type ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { Colors, FontFamily, Typography, type TypographyVariant } from '@/constants/theme';

const HANGUL = /[ㄱ-ㆎ가-힣]/;

function collectText(node: ReactNode): string {
  let out = '';
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') out += String(child);
    else if (isValidElement<{ children?: ReactNode }>(child)) out += collectText(child.props.children);
  });
  return out;
}

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: string;
  align?: TextStyle['textAlign'];
}

/**
 * 앱 공통 텍스트.
 * serif variant는 내용에 한글이 있으면 Gowun Batang, 영문/숫자면 Cormorant Garamond로 자동 전환된다.
 */
export function AppText({
  variant = 'body',
  color = Colors.text,
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  const { serif, ...base } = Typography[variant];

  let family: TextStyle;
  if (serif) {
    const isKorean = HANGUL.test(collectText(children));
    family = isKorean
      ? {
          fontFamily: FontFamily.serifKo,
          fontSize: (base.fontSize ?? 16) * 0.8,
          lineHeight: (base.lineHeight ?? 20) * 0.94,
          letterSpacing: -0.5,
        }
      : { fontFamily: FontFamily.serif, fontVariant: ['lining-nums'] };
  } else {
    family = { fontFamily: FontFamily.sans };
  }

  return (
    <Text
      {...rest}
      style={[base, family, { color }, align ? { textAlign: align } : null, serif && { includeFontPadding: false }, style]}>
      {children}
    </Text>
  );
}
