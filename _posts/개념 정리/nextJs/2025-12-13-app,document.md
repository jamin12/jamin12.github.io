---
layout: post
title: "Next.js에서 말하는 “_app.tsx”와 “_document.tsx”는 무엇인가"
date: 2025-12-13 14:00:00 +0900
categories: [개념 정리, nextJs]
tags: [Next.js, _app.tsx, _document.tsx]
---


## 1. `_app.tsx`와 `_document.tsx`는 무엇을 다루는가

두 파일의 차이를 한 줄로 요약하면 이렇다.

* **`_app.tsx`는 React 앱을 다룬다**
* **`_document.tsx`는 HTML 문서를 다룬다**

둘 다 “공통”이라는 점은 같지만,
**공통의 범위가 완전히 다르다.**

## 2. `_app.tsx`는 React 앱의 시작점이다

```tsx
// pages/_app.tsx
export default function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
```

`_app.tsx`는:

* 모든 페이지 컴포넌트를 감싸고
* 페이지 전환 시에도 유지되며
* React 트리의 최상단에 위치한다

즉 `_app.tsx`는
**“HTML 이전”이 아니라 “React 앱 내부”에 있다.**

그래서 여기에서는:

* Context Provider
* 전역 상태
* 공통 레이아웃
* 전역 CSS

같은 **React 앱 레벨의 설정**이 자연스럽다.

## 3. `_document.tsx`는 React 앱 바깥이다

```tsx
// pages/_document.tsx
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="ko">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
```

`_document.tsx`는:

* 서버에서만 실행되고
* HTML 문서 구조를 정의하며
* 브라우저에서 다시 실행되지 않는다

여기서 중요한 점은
이 파일은 **React 앱을 감싸는 “문서 틀”**이라는 것이다.

그래서:

* `<html>`, `<body>`를 직접 다루고
* meta, font preload, lang 같은 설정을 한다

하지만:

* 상태 없음
* 이벤트 없음
* hydration 대상 아님


## 4. 둘의 차이는 “실행 이후에도 살아 있느냐”다

이렇게 보면 차이가 명확해진다.

### `_app.tsx`

* React 앱의 일부
* JS bundle에 포함됨
* 브라우저에서도 실행됨
* 페이지 이동 중에도 유지됨

### `_document.tsx`

* HTML 문서 템플릿
* 서버에서 한 번 실행
* JS bundle에 포함되지 않음
* HTML 생성 후 역할 종료

즉,

> `_app`은 실행이 계속되고
> `_document`는 실행이 끝난다.


## 5. 왜 `_document`도 컴포넌트 형태일까

`_document.tsx`도 함수 형태라서
처음엔 “이것도 컴포넌트 아닌가?”라는 생각이 들 수 있다.

하지만 이건:

* React 컴포넌트라기보다는
* **React 문법으로 작성한 HTML 템플릿**

에 가깝다.

`<Main />`, `<NextScript />`는:

* UI 컴포넌트가 아니라
* “여기에 앱 결과를 끼워 넣어라”는 자리 표시자다.

## 6. 왜 둘을 하나로 합치지 않았을까

만약 `_app`과 `_document`를 합치면:

* HTML 구조와 React 상태 로직이 섞이고
* 서버 전용 코드가 브라우저로 내려갈 위험이 생긴다

그래서 Next.js는 의도적으로:

* **문서 레벨**
* **앱 레벨**

을 분리했다.

이 분리가 있었기 때문에:

* JS bundle 개념도 명확해지고
* hydration 경계도 깔끔해진다.

## 7. App Router에서는 어떻게 바뀌었나

App Router(`app/`)에서는:

* `_app.tsx`
* `_document.tsx`

가 사라지고,
이 역할을 `layout.tsx`가 흡수한다.

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

다만 개념이 사라진 건 아니다.

* React 앱 레벨 책임 → layout
* HTML 문서 레벨 책임 → layout 내부의 html/body

**개념만 합쳐졌고, 역할은 그대로 유지된다.**
