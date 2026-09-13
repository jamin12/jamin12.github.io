---
title: EAS 채널과 Play 트랙
date: 2026-09-13
order: 2
tags: [react-native, expo, devops, CI]
summary: 빌드 프로필 이름과 OTA 채널과 Play 트랙이 전부 같은 이름을 쓸 수 있는데 서로 다른 축이다
---

EAS는 Expo 앱 소스를 받아 대신 컴파일하고 Play 스토어에 제출까지 해 주는 클라우드다. 무엇을 어떻게 만들고 어디로 보낼지는 저장소 루트의 `eas.json`이 정한다.

여기서 `production`이라는 단어가 세 군데에 나온다. 빌드 프로필 이름, OTA 채널, Play 트랙이 전부 같은 이름을 쓸 수 있는데 서로 다른 축이다.

## eas.json의 구조

EAS에 주는 지시서다. `cli`, `build`, `submit` 세 덩어리로 나뉜다.

```json
{
  "cli": { "version": ">= 12.0.0", "appVersionSource": "remote", "requireCommit": true },

  "build": {
    "development": { "developmentClient": true, "distribution": "internal",
                     "android": { "buildType": "apk" }, "channel": "development" },
    "preview":     { "distribution": "internal", "android": { "buildType": "apk" },
                     "environment": "preview", "channel": "preview" },
    "production":  { "autoIncrement": true, "environment": "production", "channel": "production" }
  },

  "submit": {
    "internal":   { "android": { "track": "internal" } },
    "alpha":      { "android": { "track": "alpha" } },
    "production": { "android": { "track": "production" } }
  }
}
```

### cli 블록의 전역 규칙

| 키 | 뜻 |
|---|---|
| `requireCommit` | 워킹트리가 더러우면 빌드를 거부한다. 배포본이 저장소에 남지 않는 사고를 막는다 |
| `appVersionSource: remote` | versionCode를 EAS 서버가 관리한다. `app.json`에 적지 않는다 |

### build 블록의 빌드 프로필

프로필은 무엇을 어떻게 만들지를 정하고 `--profile <이름>`으로 고른다.

| 프로필 | 만드는 것 | 용도 |
|---|---|---|
| `development` | dev client가 든 APK | 개발용. Metro 개발 서버에 붙어 JS를 실시간으로 받는다 |
| `preview` | JS가 박힌 APK | 팀 내부 검증용. 스토어를 거치지 않고 링크로 설치 |
| `production` | AAB | Play 제출용 |

| 키 | 뜻 |
|---|---|
| `developmentClient: true` | `expo-dev-client`를 포함한다. 번들을 내장하지 않고 Metro에서 받아 실행하며 개발 메뉴가 붙는다 |
| `distribution: "internal"` | 스토어를 거치지 않고 링크나 QR로 설치할 수 있는 빌드. 생략하면 `store` |
| `android.buildType: "apk"` | AAB 대신 APK로 뽑는다. APK는 기기에 바로 설치되고 AAB는 Play 전용 포맷이다 |
| `channel` | 결과물에 박히는 OTA 수신 라벨. 이 채널로 발행된 업데이트만 받는다 |
| `environment` | 어느 EAS 환경변수 세트를 번들에 인라인할지 |
| `autoIncrement` | 빌드마다 versionCode 자동 증가. 3, 4, 5로 올라간다 |

`development`에만 `environment`가 없다. dev client는 JS를 로컬 Metro에서 받으므로 그 시점의 로컬 `.env`가 적용된다. 반대로 그 채널로 OTA를 발행할 때는 `--environment development`를 명시해야 EAS에 등록된 값이 쓰인다.

### submit 블록의 제출 프로필

제출 프로필은 Play 트랙 이름을 그대로 쓴다. 기본 경로는 비공개 테스트인 `alpha`이고, 프로덕션 트랙은 명시적으로만 고른다.

## 채널, 런타임 버전, Play 트랙

세 값 모두 배포 범위를 좁히지만 축이 전부 다르다.

| 개념 | 정하는 것 | 값 | 어디서 정해지나 |
|---|---|---|---|
| 채널 | OTA가 어느 설치본에 가나 | `development`, `preview`, `production` | 빌드 시 앱에 박힘 |
| 런타임 버전 | OTA가 호환되는 네이티브 세대 | `app.json`의 `version`과 같다 | 빌드 시 앱에 박힘 |
| Play 트랙 | 바이너리가 어느 사용자에게 가나 | `internal`, `alpha`, `beta`, `production` | 제출 시 |

**OTA는 채널과 런타임 버전이 모두 일치하는 설치본에만 도달한다.** 이 규칙이 안전장치다. Expo 앱에서 `eas update`로 갈아끼울 수 있는 것은 JS 번들뿐이고 네이티브 바이너리는 그대로 남는데, 네이티브 모듈이 없는 구버전 앱에 그 모듈을 부르는 새 JS가 들어가면 앱이 죽는다. 런타임 버전이 그 조합을 구조적으로 막는다. 네이티브 모듈을 추가하면서 버전을 1.0.1에서 1.1.0으로 올린 WebView 전환을 OTA로 낼 수 없었던 것도 이 때문이고, 그게 올바른 동작이다.

**채널과 트랙은 이름이 겹쳐도 완전히 다른 축이다.** 빌드 프로필 이름이 `production`이어도 트랙을 지정하지 않으면 Play는 `internal`로 올린다.

## 환경변수가 박히는 시점

`EXPO_PUBLIC_*`는 런타임 값이 아니다. 빌드나 OTA 번들을 만드는 순간 코드에 문자열로 인라인된다.

| 위치 | 용도 |
|---|---|
| 로컬 `.env` | 개발용. gitignore이고 EAS 빌드 서버는 읽지 않는다 |
| EAS 환경변수 | 빌드와 OTA의 단일 소스. `eas.json`의 `environment`로 자동 로드 |

```bash
eas env:list --environment production
eas env:set --environment production --name KEY --value VALUE --type string --visibility plaintext
```

값을 바꾸면 반드시 다시 빌드하거나 OTA를 발행해야 반영된다. Next.js의 `NEXT_PUBLIC_*`도 같은 성질이라 이미지 재빌드가 필요하다.
