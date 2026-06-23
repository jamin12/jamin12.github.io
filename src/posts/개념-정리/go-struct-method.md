---
title: "Go의 struct와 메서드"
date: 2026-06-11
tags: [go, struct, method, receiver]
---

Go에는 클래스가 없고 `struct`가 그 역할을 대신한다. 그런데 자바·코틀린처럼 클래스 중괄호 안에 메서드를 넣는 게 아니라, **데이터(struct)와 행동(메서드)을 물리적으로 분리**해서 쓴다. 이 분리 방식이 처음엔 낯설지만 Go 코드를 읽는 데 가장 기본이 되는 문법이다.

## 메서드는 struct 밖에 쓴다

struct 안에 메서드를 넣으려 하면 컴파일 에러다.

```go
type BannerService struct {
    repo Repo
    func Create() {}   // ❌ struct 안에 메서드 정의 불가
}
```

메서드는 반드시 struct 밖에서 정의하고, "누구 소속인지"를 리시버(receiver)로 표시한다.

```go
type BannerService struct {   // ① 데이터만
    repo Repo
}

func (s *BannerService) Create() {}   // ② 행동은 밖에서, 리시버로 연결
```

이 둘이 합쳐져서 코틀린 클래스 하나가 된다.

```kotlin
class BannerService(private val repo: Repo) {
    fun create() { /* 여기의 this가 Go의 s */ }
}
```

## 리시버 = this

`func (s *BannerService) Create()`에서 `(s *BannerService)`가 리시버다. 자바·코틀린의 `this`에 해당하고, 이름을 직접 정한다(관례상 짧게 `s`, `u`, `g` 등). 메서드 본문에서 `s.repo`로 필드에 접근하는 것은 `this.repo`와 같다.

```go
func (s *BannerService) Create() {
    s.repo.Save()   // this.repo.save()
}
```

## struct 필드는 메서드들이 공유한다

같은 타입에 매달린 모든 메서드는 그 struct의 필드를 공유한다. 이게 객체의 상태를 공유하는 방식이다.

```go
type BannerService struct {
    repo   Repo
    config Config
}

func (s *BannerService) Create() { s.repo.Save(...) }    // repo, config 공유
func (s *BannerService) Update() { s.config.Get(...) }   // 같은 필드 사용
```

코틀린의 프로퍼티를 여러 메서드가 공유하는 것과 정확히 같다. 그래서 실무 Go 코드는 보통 다음 모양으로 나온다. struct 선언 바로 아래에 그 타입의 메서드들이 줄줄이 붙는다.

```go
type XxxUsecase struct { /* 필드 */ }

func (u *XxxUsecase) DoSomething(...) {}
func (u *XxxUsecase) DoAnother(...) {}
```

## 함수를 "필드로" 담는 것은 가능하다

메서드는 struct 안에 못 넣지만, **함수 자체를 값으로 필드에 담는 것**은 된다. 이건 메서드가 아니라 콜백·전략을 담는 변수다.

```go
type Handler struct {
    Name    string
    OnClick func(int) error   // 함수 타입 필드 (메서드 아님)
}

h := Handler{ OnClick: func(n int) error { return nil } }
h.OnClick(5)
```

코틀린의 람다 프로퍼티 `val onClick: (Int) -> Unit`와 같다. 진짜 메서드와의 차이는 분명하다. 메서드는 타입에 고정되고 리시버로 상태에 접근하지만, 함수 필드는 인스턴스마다 다른 함수를 담을 수 있고 리시버 접근은 없다. 실무에서는 99% 진짜 메서드를 쓰고, 함수 필드는 콜백이나 테스트용 mock 같은 특수한 경우에만 쓴다.

## 왜 메서드를 밖에 둘까

Go가 이렇게 설계한 데는 이유가 있다. 메서드를 타입 정의와 분리하면 **struct뿐 아니라 어떤 타입에도 메서드를 붙일 수 있다.** 기본 타입 위에 얹은 defined type에도 메서드가 붙는다.

```go
type Celsius float64
func (c Celsius) ToFahrenheit() Celsius { return c*9/5 + 32 }   // float에 메서드
```

코틀린의 확장 함수(`fun Int.double()`)와 비슷한 자유도다. 또한 데이터와 행동이 분리되어 있어, struct 정의만 보면 "이 타입이 어떤 데이터인지" 한눈에 들어온다.
