---
layout: post
title: "HackerRank - Castle on the Grid"
date: 2026-01-29
categories: [코테]
tags: [bfs, graph]
math: true
---

## 문제

{% include link-preview.html url="https://www.hackerrank.com/challenges/castle-on-the-grid/problem" title="Castle on the Grid" %}

## 풀이

격자판에서 출발점부터 도착점까지 최소 이동 횟수를 구하는 문제였다. 한 번의 이동은 상하좌우 중 한 방향을 선택해 벽(`X`)이나 격자 끝을 만나기 전까지 원하는 만큼 가는 것이었다.

경로의 비용이 1로 동일했기 때문에 BFS를 사용했다. 각 칸을 노드로 보고 이동 가능한 관계를 간선으로 정의했다.

이웃 노드를 정의할 때 단순히 상하좌우 한 칸이 아니라 한 방향으로 이동하면서 멈출 수 있는 모든 지점을 포함했다. 중간 칸도 멈출 수 있는 지점이었기 때문이다.

`dist[][]` 배열을 `-1`로 초기화해서 방문 여부와 이동 횟수를 동시에 관리했다. BFS 특성상 특정 칸을 처음 방문했을 때의 값이 최단 이동 횟수가 되었다.

특정 칸 `(x, y)`에서 상하좌우를 각각 탐색하며 벽을 만나기 전까지 만나는 모든 빈 칸을 확인했다. 아직 방문하지 않은 칸이면 현재 거리에 1을 더해 기록하고 큐에 넣었다. 이미 방문한 칸은 무시하고 계속 진행했다.

처음에는 "한 번의 이동"을 방향의 끝까지 가는 것으로 잘못 이해했다. 실제로는 이동 경로 상의 어떤 빈 칸에서도 멈출 수 있는 것이었다. 경로 도중의 특정 칸을 거쳐 다른 방향으로 꺾는 경우가 최단 경로가 될 수 있었다.

내부에 반복문을 두어 한 방향으로 전진하며 만나는 모든 유효한 칸을 큐에 추가하는 방식으로 해결했다.

## 코드

```kotlin
fun minimumMoves(grid: Array<String>, startX: Int, startY: Int, goalX: Int, goalY: Int): Int {
    val n = grid.size
    val dist = Array(n) { IntArray(n) { -1 } }

    val q = ArrayDeque<Pair<Int, Int>>()
    q.add(startX to startY)
    dist[startX][startY] = 0

    val dirs = arrayOf(1 to 0, -1 to 0, 0 to 1, 0 to -1)

    while (q.isNotEmpty()) {
        val (x, y) = q.removeFirst()
        val d = dist[x][y]

        for ((dx, dy) in dirs) {
            var nx = x + dx
            var ny = y + dy

            while (nx in 0 until n && ny in 0 until n && grid[nx][ny] != 'X') {
                if (dist[nx][ny] == -1) {
                    dist[nx][ny] = d + 1
                    q.add(nx to ny)
                }
                nx += dx
                ny += dy
            }
        }
    }

    return dist[goalX][goalY]
}
```
