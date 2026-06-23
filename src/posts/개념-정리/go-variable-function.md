---
title: "Go의 변수 선언과 함수"
date: 2026-06-11
tags: [go, variable, function, multiple-return, short-declaration]
order: 6
---

문법 기초를 한 번 정리하고 넘어가면 Go 코드가 훨씬 빠르게 읽힌다. 이 글은 변수 선언(`:=`, `var`, `const`), 함수 시그니처, 다중 반환을 다룬다. 코틀린과 닮은 듯 미묘하게 다른 지점들이 있다.

## 함수 시그니처 분해

전형적인 메서드 시그니처를 한 줄씩 뜯어 보자.

```go
func (u *BannerV2Usecase) CreateBannerV2(ctx context.Context, param CreateRequest) IError {
```

- `func` — 함수 키워드 (코틀린 `fun`)
- `(u *BannerV2Usecase)` — 리시버. 이 메서드가 속한 타입과 `this`
- `CreateBannerV2` — 메서드 이름. 첫 글자가 대문자라 public
- `(ctx context.Context, param CreateRequest)` — 파라미터
- `IError` — 반환 타입

핵심은 **타입이 이름 뒤에 온다**는 점이다. 코틀린과 같은 순서이고 자바와 반대다.

| Go | 코틀린 | 자바 |
|---|---|---|
| `param CreateRequest` | `param: CreateRequest` | `CreateRequest param` |
| `func f() IError {` | `fun f(): IError {` | `IError f() {` |

반환 타입은 파라미터 괄호 뒤, 본문 `{` 앞에 쓴다. 코틀린은 반환 타입을 추론할 수 있지만 **Go는 반환 타입을 반드시 명시**해야 한다.

## `:=` vs `=` vs `var` vs `const`

`:=`는 변수 선언과 할당을 동시에 하는 단축 문법이다. 코틀린의 `val x = 10`과 거의 같다.

```go
x := 10    // 새 변수 선언 + 할당 (타입 추론)
x = 20     // 이미 있는 변수에 재할당
```

`:=`는 처음 만들 때 한 번, `=`는 그다음부터 쓴다. 원래 풀어쓰면 다음과 같다.

```go
var x int = 10   // 정식
var x = 10       // 타입 생략
x := 10          // var도 생략 (함수 안에서 가장 흔함)
```

주의할 점 두 가지가 있다. `:=`는 **함수 안에서만** 쓸 수 있고(전역은 `var`), 왼쪽에 새 변수가 최소 하나는 있어야 한다.

```go
var globalConfig = loadConfig()   // 전역은 var
func f() {
    x := 10        // 함수 안은 :=
    x, y := 1, 2   // x는 재할당, y는 새 변수 → 허용
}
```

## const는 코틀린 val이 아니다

Go의 두 변수 키워드는 `var`(가변)와 `const`(상수)다. 형태는 코틀린 `var`/`val`처럼 둘이지만, `const`는 코틀린 `val`보다 훨씬 제한적이다.

코틀린 `val`은 런타임 값(객체, 함수 결과)도 담을 수 있는 "재할당 금지 변수"다. 반면 Go `const`는 **컴파일 타임에 확정되는 값만** 담는다.

```go
const max = 100        // OK
const name = "Koa"     // OK
const user = getUser() // ❌ 함수 결과는 const 불가
const list = []int{1}  // ❌ 슬라이스/객체 불가
```

즉 Go에는 "런타임 값을 담는 불변 변수"가 없다. 객체나 함수 결과는 무조건 `var`/`:=`(가변)로만 담을 수 있고, 불변성은 관례로 지킨다. 코틀린 `val`의 컴파일 보장을 기대하면 안 된다.

## 다중 반환

Go의 시그니처 기능은 함수가 값을 여러 개 동시에 반환할 수 있다는 점이다. 코틀린은 `Pair`로 감싸야 하지만 Go는 언어 차원에서 지원한다.

```go
func getCoupon(id int64) (Coupon, error) {
    if id <= 0 {
        return Coupon{}, errors.New("invalid id")   // 실패: 빈 값 + 에러
    }
    return findCoupon(id), nil                       // 성공: 값 + nil
}
```

받을 때는 `:=`로 여러 변수에 한 번에 받는다.

```go
coupon, err := getCoupon(123)
if err != nil {
    return err
}
fmt.Println(coupon.Name)
```

안 쓰는 반환값은 `_`(블랭크)로 버린다. Go는 선언하고 안 쓰는 변수를 컴파일 에러로 막기 때문에, 정말 안 쓸 거면 `_`로 받아야 한다.

```go
coupon, _ := getCoupon(123)   // 에러 무시
_, err := getCoupon(123)      // 값 버리고 에러만
```

맵 조회에서 자주 보는 `value, ok` 패턴도 다중 반환이다.

```go
value, ok := myMap[key]   // 값 + 존재 여부
if !ok { ... }
```

## 에러는 예외가 아니라 반환값이다

위 예시에서 보이듯, Go에는 예외가 없다. `throw`/`try-catch` 대신 에러를 값으로 반환한다. 그래서 다음 관용구가 Go 코드 전체에 깔려 있다.

```go
result, err := doSomething()
if err != nil {
    return err   // 에러 처리 또는 전파
}
// result 사용
```

자바의 `try { ... } catch (e) { ... }`를 매 호출마다 `if err != nil`로 푸는 셈이다. 장황해 보이지만 "에러를 숨기지 않고 매번 눈앞에서 처리한다"는 게 Go의 철학이다. 에러 처리, `panic`, `defer`는 다음 글에서 따로 다룬다.
