---
title: "Go의 인터페이스 — implements가 없다"
date: 2026-06-11
tags: [go, interface, duck-typing, structural-typing]
---

Go에도 인터페이스가 있다. 그런데 자바·코틀린처럼 `class Foo implements Bar`라고 선언하는 곳이 어디에도 없다. 그러면 어떤 타입이 어떻게 그 인터페이스의 구현체가 되는 걸까. 답은 Go 인터페이스의 핵심이자 자바와 가장 다른 지점이다. **Go는 구현을 선언하지 않는다. 메서드만 갖추면 자동으로 구현체가 된다.**

## 자바는 명시적, Go는 암묵적

자바·코틀린은 구현 클래스가 "나 이 인터페이스 구현해요"라고 명시한다.

```kotlin
interface Repo { fun save() }
class GopgRepo : Repo {        // ← : Repo 로 명시 선언
    override fun save() {}
}
```

Go에는 `implements`도 `: Repo`도 없다. 인터페이스가 요구하는 메서드를 그 타입이 다 가지고 있으면, 선언 없이 자동으로 그 인터페이스를 만족한다.

```go
type Repo interface {
    Save()
}

type GopgRepo struct{}
func (g *GopgRepo) Save() {}   // Save()가 있다 → 끝.
                               // 어디에도 "Repo를 구현한다"고 쓰지 않는다
```

`*GopgRepo`는 `Save()` 메서드를 가지므로 자동으로 `Repo`를 만족한다. 그래서 `Repo`가 필요한 자리에 그냥 넣을 수 있다.

```go
var r Repo = &GopgRepo{}   // OK. 컴파일러가 "Save() 있네, Repo 맞네"
```

이것을 구조적 타이핑(structural typing), 흔히 덕 타이핑(duck typing)이라 부른다. 선언이 아니라 타입의 모양(메서드 구성)으로 판단한다. "오리처럼 걷고 오리처럼 운다면 오리다."

## 상속이 아니라 계약 만족이다

"인터페이스를 구현한다"가 자바에서는 상속 비슷하게 느껴지지만, Go에서는 부모-자식 관계가 전혀 생기지 않는다. 단지 "이 메서드들을 가졌는가"라는 계약 체크일 뿐이다. 타입이 인터페이스의 요구를 충족하면 그 자리에 쓸 수 있고, 그뿐이다.

실제 프로젝트에서도 같다. 리포지토리 구현이 포트를 만족하는 방식을 보자.

```go
// 포트 (인터페이스)
type ICoupon interface {
    GetCoupon(ctx context.Context, id int64) (Coupon, error)
}

// 구현 — "implements ICoupon" 같은 선언이 전혀 없다
func (g *gopg) GetCoupon(ctx context.Context, id int64) (Coupon, error) {
    // ... DB 조회 ...
}
```

`gopg`는 `GetCoupon` 메서드를 가지므로 자동으로 `ICoupon`을 만족한다. 둘을 잇는 선언은 코드 어디에도 없다.

## 인터페이스는 쓰는 쪽에서 정의한다

암묵적 구현이 주는 가장 큰 효과가 이것이다. 인터페이스를 구현체가 아니라 **쓰는 쪽(소비자)에서** 정의할 수 있다.

자바는 구현 클래스가 인터페이스를 미리 `implements`해야 해서, 인터페이스가 구현체에 묶인다. Go는 반대다. 유스케이스가 "나는 `GetCoupon` 할 줄 아는 뭔가가 필요하다"고 자기 필요에 맞는 인터페이스를 정의하고, 그 메서드를 이미 가진 타입들이 자동으로 만족한다.

그래서 Go에서는 인터페이스를 작게, 그리고 호출하는 쪽 가까이에 두는 게 관용이다. "인터페이스를 받고, 구체 타입을 반환하라(accept interfaces, return structs)"는 말도 여기서 나온다. 앞서 본 클린 아키텍처에서 "포트를 안쪽(소비자)에 둔다"가 자연스럽게 가능한 이유도 이 암묵적 구현 덕분이다.

## 실수 방지: 컴파일 타임 체크

암묵적이라 편하지만 함정도 있다. 의도한 인터페이스를 만족하도록 메서드를 구현하다가 시그니처를 틀리거나 하나를 빠뜨려도, 그 인터페이스를 실제로 쓰는 곳에 도달하기 전까지는 컴파일 에러가 나지 않는다.

그래서 "이 타입은 이 인터페이스를 반드시 만족한다"를 못박고 싶을 때 이 한 줄을 넣는다.

```go
var _ ICoupon = (*gopg)(nil)   // gopg가 ICoupon을 만족 안 하면 컴파일 에러
```

변수를 만들지도 않고(`_`로 버린다) 값도 `nil`이다. 단지 컴파일러에게 "이 타입이 이 인터페이스를 만족하는지 지금 확인하라"고 강제하는 관용구다. 자바의 `implements`가 주던 명시적 보장을 필요한 곳에서만 수동으로 켜는 셈이다.

## 인터페이스 임베딩

인터페이스끼리 합쳐 더 큰 인터페이스를 만들 수 있다. 이를 임베딩이라 한다.

```go
type Reader interface { Read(p []byte) (int, error) }
type Writer interface { Write(p []byte) (int, error) }

type ReadWriter interface {   // 둘을 합침
    Reader
    Writer
}
```

`ReadWriter`는 `Read`와 `Write`를 모두 요구한다. 표준 라이브러리의 `io.ReadWriter`가 정확히 이렇게 만들어져 있다. 작은 인터페이스를 조합해 큰 인터페이스를 만드는 것도 Go의 합성 지향을 보여준다.

## 빈 인터페이스와 타입 단언

메서드가 하나도 없는 인터페이스 `interface{}`는 모든 타입이 만족한다(요구하는 메서드가 없으므로). 그래서 "아무 타입이나"를 뜻한다. Go 1.18부터는 `any`라는 별칭으로 더 자주 쓴다.

```go
func printAny(v any) { ... }   // 어떤 값이든 받음
```

`any`로 받은 값에서 원래 타입을 꺼내려면 타입 단언(type assertion)이나 타입 스위치를 쓴다.

```go
switch x := v.(type) {
case string: fmt.Println("문자열", x)
case int:    fmt.Println("정수", x)
}
```

이 타입 스위치가 다른 글에서 언급한 sealed class 흉내의 분기 도구다.

## fx는 매핑을 명시해 줘야 한다

컴파일러는 "gopg가 ICoupon을 만족한다"를 자동으로 알지만, fx 같은 런타임 DI는 그렇지 않다. 어떤 구현을 어떤 인터페이스로 제공할지 명시적으로 알려줘야 한다.

```go
fx.Provide(
    fx.Annotate(NewGopg, fx.As(new(ICoupon))),   // 이 구현을 ICoupon으로 등록
)
```

컴파일러의 암묵적 만족과 별개로, fx 그래프에 "이 타입 = 이 인터페이스" 매핑을 등록하는 것이다. 이 부분은 의존성 주입 글에서 더 다룬다.
