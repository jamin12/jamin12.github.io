---
title: Modbus 센서 데이터 수집
date: 2024-12-28
tags: [modbus, kotlin, serial-통신, 센서, jmod, influxdb, aws]
---

여러 개의 센서에서 데이터를 수집해야 하는 프로젝트가 있었다. 센서들은 Modbus라는 산업용 통신 프로토콜로 연결되어 있었고, Kotlin + jMod 라이브러리 조합으로 데이터를 가져오는 구조를 만들었다.

## Modbus 프로토콜

Modbus는 산업 자동화 쪽에서 널리 쓰이는 통신 프로토콜이다. 구조가 단순해서 이해하기 어렵지 않았다.

마스터-슬레이브 방식으로 동작한다. 중앙 시스템(마스터)이 각 센서(슬레이브)에 "데이터 줘"라고 요청하면, 센서가 응답하는 구조다. 슬레이브 안에는 Coil, Discrete Input, Holding Register, Input Register 같은 메모리 맵이 있고, 요청할 때 어떤 메모리 맵을 읽을지 Function Code로 지정해야 한다.

| Function Code | 설명 |
|---|---|
| 01 | Coil 읽기 |
| 02 | Discrete Input 읽기 |
| 03 | Holding Register 읽기 |
| 04 | Input Register 읽기 |
| 05 | Single Coil 쓰기 |
| 06 | Single Register 쓰기 |
| 15 | Multiple Coils 쓰기 |
| 16 | Multiple Registers 쓰기 |

전송 방식은 RTU(직렬 통신 기반), ASCII(가독성 좋은 텍스트 형태), TCP/IP(이더넷 기반) 세 가지가 있다. 이 프로젝트에서는 RTU를 사용했다.

## Serial 통신

Modbus RTU는 직렬 통신 위에서 돌아가기 때문에, 직렬 통신에 대한 이해가 먼저 필요했다.

직렬 통신 표준에는 RS232, RS422, RS485가 있다. RS232는 1:1 통신만 되고 노이즈에 약하다. RS422는 전이중 방식이라 송수신이 동시에 가능하고 장거리에 적합하다. RS485는 반이중이지만 하나의 버스에 최대 32개 장치를 연결할 수 있어서, 센서 여러 개를 다루는 우리 프로젝트에 맞았다.

통신 설정에서 중요한 건 bps(전송 속도, 보통 9600), 데이터 길이(8비트), 패리티(에러 검출용), 정지 비트(프레임 끝 표시) 네 가지다. 센서마다 설정이 다를 수 있어서 스펙시트를 하나하나 확인해야 했다.

## RTU 패킷 구조

실제로 센서와 주고받는 패킷은 이런 구조다.

요청 패킷:

| 필드 | 설명 | 크기 |
|---|---|---|
| Slave ID | 통신할 슬레이브 장치의 ID | 1 Byte |
| Function Code | 수행할 작업 | 1 Byte |
| 시작 주소 | 데이터를 읽거나 쓸 시작 주소 | 2 Byte |
| 데이터 개수 | 요청하려는 데이터의 개수 | 2 Byte |
| CRC | 에러 검출 값 | 2 Byte |

응답 패킷:

| 필드 | 설명 | 크기 |
|---|---|---|
| Slave ID | 응답을 보낸 슬레이브 장치의 ID | 1 Byte |
| Function Code | 응답의 작업 유형 | 1 Byte |
| 데이터 길이 | 응답 데이터의 길이 | 1 Byte |
| 데이터 | 요청한 데이터 | 2 Byte × N (가변) |
| CRC | 에러 검출 값 | 2 Byte |

## Kotlin + jMod 구현

Kotlin을 선택한 이유는 간결한 문법과 자바 호환성도 있었지만, 여러 센서 데이터를 동시에 처리해야 했기 때문에 코루틴 기반 비동기 처리가 결정적이었다. jMod는 Modbus 통신을 지원하는 가벼운 자바 라이브러리로, 프로토콜의 복잡한 부분을 감춰줘서 구현이 훨씬 수월했다.

## 바이트 데이터 변환

Modbus에서 수집한 데이터는 바이트 코드 형태로 들어온다. 사람이 읽을 수 있는 값으로 변환하려면 상위 바이트와 하위 바이트를 결합해야 했다.

```kotlin
fun combineBytes(high: Byte, low: Byte): Int {
    return ((high.toInt() shl 8) or (low.toInt() and 0xFF))
}

val combinedData = combineBytes(rawData[0], rawData[1])
```

## 엔디안 문제

여기서 한 가지 문제가 터졌다. 센서마다 바이트 순서(엔디안)가 달랐다. 어떤 센서는 빅엔디안, 어떤 센서는 리틀엔디안으로 데이터를 보내고 있었다. 같은 바이트 조합이라도 엔디안이 다르면 완전히 다른 값이 나온다.

센서별로 엔디안 정보를 관리할 수 있도록 enum으로 정리했다.

```kotlin
enum class Sensor(val id: Int, val isBigEndian: Boolean) {
    TEMPERATURE(1, true),
    PRESSURE(2, false),
    HUMIDITY(3, true);

    companion object {
        fun fromId(id: Int): Sensor? {
            return values().find { it.id == id }
        }
    }
}

val sensor = Sensor.fromId(slaveId)
val finalData = sensor?.let {
    processEndian(combinedData, it.isBigEndian)
}
```

SlaveId로 센서를 식별하고, 해당 센서의 엔디안 설정에 맞춰 데이터를 변환하는 구조다. 센서가 추가되면 enum에 한 줄만 넣으면 되니 관리도 깔끔했다.

## 데이터 흐름 아키텍처

센서에서 데이터를 수집하는 것까지는 해결했는데, 이걸 어디에 어떻게 저장하고 서비스까지 전달할지가 다음 문제였다. 하드웨어에서 들어오는 데이터는 시계열 특성이 강하고 조회와 저장이 빈번하게 일어나기 때문에 InfluxDB를 선택했다.

### Kafka 도입과 철회

처음에는 대량 데이터 유입에 대비해서 Kafka를 두고 InfluxDB로 넘기는 구조를 잡았다. 그런데 AWS의 Kafka(MSK) 비용이 너무 비쌌다. 현재 트래픽 규모에서는 Lambda로도 충분히 처리할 수 있다고 판단해서 Kafka를 걷어냈다.

### EFS로 데이터 유실 방지

Kafka가 있을 때는 데이터가 Kafka까지만 도달하면 유실 걱정이 없었다. 하지만 Lambda로 바꾸면서 InfluxDB에 저장되기 전에 Lambda가 실패하면 데이터가 날아가는 구조가 되어버렸다. 이걸 막기 위해 EFS를 중간 저장소로 두었다. Lambda가 데이터를 받으면 EFS에 먼저 저장하고, InfluxDB 서버가 죽었다가 복구되면 EFS에 쌓인 데이터를 읽어서 다시 저장하도록 설정했다.

### 외부 흐름 (현장 → 클라우드)

``` mermaid
sequenceDiagram
    participant HW as Hardware
    participant LC as Local Computer
    participant LI as Local InfluxDB
    participant AG as API Gateway

    HW->>LC: 데이터 수신 (Modbus)
    LC->>LI: 데이터 저장
    LI->>LC: 데이터 호출
    LC->>AG: 데이터 전송
```

현장에서도 통신이 끊어질 경우를 대비해서 로컬에 InfluxDB를 하나 두고 먼저 저장한 뒤 클라우드로 전송하도록 했다. 네트워크가 끊겨도 로컬에 데이터가 남아있으니 복구가 가능한 구조다.

### 내부 흐름 (클라우드)

``` mermaid
sequenceDiagram
    participant AG as API Gateway
    participant LM as Lambda
    participant EFS as EFS
    participant IF as InfluxDB
    participant EB as EventBridge
    participant SB as SpringBatch
    participant RDS as RDS

    AG->>LM: Lambda 호출
    LM->>EFS: 데이터 저장
    LM->>IF: 데이터 저장
    EB->>SB: 주기적 호출
    SB->>IF: 데이터 가져오기
    SB->>RDS: 데이터 저장
```

클라우드 안에서는 API Gateway가 Lambda를 호출하고, Lambda가 EFS와 InfluxDB에 동시에 저장한다. 이후 EventBridge가 주기적으로 SpringBatch를 트리거해서 InfluxDB의 데이터를 RDS로 옮기는 구조다. InfluxDB는 시계열 조회에 특화되어 있지만, 서비스에서 다른 테이블과 조인해서 쓸 데이터는 결국 RDS에 있어야 했기 때문이다.

## 참고

- [Modbus 프로토콜 설명 영상](https://www.youtube.com/watch?v=jhRcq6bsJ84&list=PLz--ENLG_8TPJsTDyihX9_fdpLPFdd1xl)
