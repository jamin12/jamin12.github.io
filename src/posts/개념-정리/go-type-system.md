---
title: "Go에는 클래스가 없다"
date: 2026-06-11
tags: [go, struct, type, interface, encapsulation]
---

코틀린에는 클래스 종류가 여럿이다. 일반 `class`, `data class`, `value class`, `enum class`, `sealed class`, `object`. 상황에 맞는 종류를 골라 쓴다. Go로 넘어오면 이 선택지가 통째로 사라진다. **Go에는 클래스라는 개념 자체가 없다.**

대신 `type` 키워드 하나로 모든 타입을 정의하고, 그 뒤에 무엇을 쓰느냐로 갈린다. 클래스 계층도, 상속도 없다. 이 글은 코틀린의 클래스 종류가 Go에서 각각 무엇으로 대체되는지 정리한다.

## Go의 타입은 다섯 가지뿐

```go
type 이름 종류
```

| 종류 | 예시 | 역할 |
|---|---|---|
| struct | `type User struct { Name string }` | 필드 묶음 (사실상 클래스) |
| interface | `type Repo interface { Save() }` | 메서드 계약 |
| defined type | `type UserID int64` | 기본 타입 위의 새 타입 |
| 함수 타입 | `type Handler func(int) error` | 함수를 타입으로 |
| 컬렉션 별칭 | `type Set map[string]bool` | map/slice 별칭 |

이게 전부다. 나머지는 전부 이 재료의 조합으로 만든다.

## 코틀린 클래스 종류별 대응

**일반 class → struct + 메서드.** 코틀린은 클래스 중괄호 안에 메서드를 넣지만, Go는 데이터(struct)와 행동(메서드)을 분리한다. 메서드는 struct 밖에서 리시버로 붙인다. (이 부분은 다음에 자세히 다룬다.)

```go
type BannerService struct {
    repo Repo
}
func (s *BannerService) Create() { ... }   // 메서드는 밖에
```

**data class → 그냥 struct.** 단, 코틀린 `data class`가 공짜로 주던 `equals`, `hashCode`, `toString`, `copy`가 Go에는 없다. 비교 `==`는 필드가 전부 비교 가능한 타입이면 자동으로 되고, `toString`은 `String()` 메서드를 직접 구현해야 한다. `copy()`는 `u2 := u1`처럼 값 복사가 기본이라 따로 필요 없다.

**value class → defined type.** 기본 타입 위에 별도 타입을 얹어 타입 안전성을 얻는다.

```go
type UserID int64   // int64지만 별도 타입 → 다른 int64를 못 넣음
```

**enum class → const + iota.** Go에는 enum 키워드가 없다. 정수 위 defined type과 상수 묶음으로 흉내 낸다.

```go
type Status int
const (
    Active Status = iota   // 0
    Inactive               // 1
)
```

`iota`는 0, 1, 2…를 자동으로 증가시켜 주는 도구다.

**sealed class → interface로 흉내.** 직접 대응이 없어 마커 메서드를 가진 인터페이스로 봉인을 흉내 내고, `switch v := r.(type)`로 분기한다.

**object(싱글톤) → 패키지 함수 또는 package-level 변수.** 패키지 자체가 네임스페이스라 그냥 함수로 두거나, 단일 인스턴스를 변수로 관리한다.

**abstract class → 없음.** 상속이 없으므로 추상 클래스 개념도 없다. 공통 구현이 필요하면 임베딩(합성)을 쓴다.

## 자바·코틀린과 다른 세 가지

**상속이 없다.** `class Dog : Animal()` 같은 게 없다. 대신 합성과 임베딩으로 해결한다.

```go
type Base struct { ... }
type Service struct {
    Base   // 임베딩: Base의 필드/메서드를 끌어다 씀 (상속이 아니라 합성)
}
```

**생성자가 없다.** `constructor` 키워드가 없다. 관례적으로 `NewXxx()` 함수를 만들어 쓴다.

```go
func NewBannerService(repo Repo) *BannerService {
    return &BannerService{repo: repo}
}
```

**접근제어가 키워드가 아니라 대소문자다.** `public`/`private` 키워드가 없다. 첫 글자가 대문자면 public, 소문자면 private이다. 그리고 그 경계는 클래스가 아니라 **패키지(폴더)** 단위다.

```go
type User struct {
    Name string   // 대문자 → 외부 패키지에서 접근 가능
    age  int       // 소문자 → 같은 패키지 안에서만
}
```

자바의 "한정자 없는 기본 접근(package-private)"이 Go의 소문자와 가장 비슷하다. `protected`는 상속이 없으니 아예 존재하지 않는다.

## 캡슐화 관용구: public 인터페이스 + private 구현

이 대소문자 규칙을 이용한 전형적인 패턴이 있다. 인터페이스는 대문자로 노출하고, 구현 struct는 소문자로 숨긴다.

```go
type IUsecase interface { ... }   // public 계약
type usecase struct { ... }       // private 구현 (소문자)

func New(...) IUsecase {          // 생성자는 public, 인터페이스 반환
    return &usecase{...}          // 실제 타입은 숨김
}
```

외부는 `IUsecase` 인터페이스만 알고 구현 `usecase`는 건드릴 수 없다. 자바의 `private 생성자 + 팩토리 메서드 + public interface` 캡슐화와 같은 효과다.
