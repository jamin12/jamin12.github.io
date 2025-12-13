---
layout: post
title: "Next.js에서 말하는 “컴포넌트”란 무엇인가"
date: 2025-12-13 14:00:00 +0900
categories: [개념 정리, nextJs]
tags: [Next.js, 컴포넌트]
---

## 1. 컴포넌트는 “HTML을 반환한다”는 말의 정확한 의미

컴포넌트는 흔히 이렇게 표현된다.

> “컴포넌트는 HTML을 반환하는 함수다”

이 말 자체는 틀리지 않다.
다만 여기서 말하는 HTML은 **이미 만들어진 문서**가 아니라,

> **실행 시점에 계산되어 나오는 UI 결과**

에 가깝다.

```tsx
function Button() {
  return <button>Click</button>;
}
```

이 함수는:

* HTML을 저장하고 있는 게 아니라
* 실행될 때마다
* React Element를 계산해서 반환한다

즉, 컴포넌트는 **결과물이 아니라 계산 과정**이다.

---

## 2. 컴포넌트는 항상 “실행된다”

컴포넌트를 이해할 때 가장 중요한 포인트는
컴포넌트는 항상 **실행된다는 점**이다.

```tsx
function Greeting({ name }) {
  return <p>Hello {name}</p>;
}
```

이 코드는:

* props라는 입력을 받고
* 그 시점의 값에 따라
* 결과 UI를 결정한다

그래서 컴포넌트는 정적인 템플릿이 아니라
**입력 → 출력 구조를 가진 함수**로 보는 게 정확하다.

---

## 3. 실행 위치가 컴포넌트의 역할을 바꾼다

같은 컴포넌트라도 **어디서 실행되느냐**에 따라
의미가 완전히 달라진다.

### Server Component

```tsx
export default async function Page() {
  const data = await fetch("http://api/projects");
  return <ul>{/* ... */}</ul>;
}
```

이 컴포넌트는:

* 서버에서 실행되고
* 데이터를 조회한 뒤
* HTML을 계산해서
* 결과만 브라우저로 보낸다

이 경우 컴포넌트는
**HTML 생성기 역할**에 가깝다.

---

### Client Component

```tsx
"use client";

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

이 컴포넌트는:

* 브라우저에서 실행되고
* 상태를 유지하며
* 이벤트에 따라 다시 실행된다

이 경우 컴포넌트는
**UI 동작 로직**이 된다.

---

## 4. 컴포넌트는 함수이기 때문에 파일 구성도 자유롭다

컴포넌트는 특별한 개체가 아니라
그냥 함수이기 때문에
한 파일에 여러 개를 정의하는 것도 자연스럽다.

```tsx
function Header() {
  return <header>Header</header>;
}

function Footer() {
  return <footer>Footer</footer>;
}

export default function Page() {
  return (
    <>
      <Header />
      <Footer />
    </>
  );
}

export { Header, Footer };
```

여기서:

* `Page`는 default export
* `Header`, `Footer`는 named export

Next.js는 이 중
**default export만 페이지 엔트리로 사용**한다.

---

## 5. page.tsx의 컴포넌트가 특별한 이유

`app/**/page.tsx`에 정의된 default export 컴포넌트는:

* 일반 컴포넌트이면서
* 동시에 해당 URL의 진입점이다

즉,

> 컴포넌트라는 개념은 같지만
> page 컴포넌트는 “조합과 시작”의 책임을 가진다.

그래서 보통 page에서는:

* 데이터를 준비하고
* 하위 컴포넌트를 조합한다