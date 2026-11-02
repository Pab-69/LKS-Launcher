-- LKS : appli en jeu pour le Custom Shaders Patch.
-- Angle de drift, score du tour et écart avec ton meilleur tour de la session.

local BUCKETS = 1000
local best = nil        -- temps (ms) par portion du meilleur tour de la session
local bestTime = nil
local current = {}
local lastLapCount = -1
local lapScore = 0
local bestScore = 0

-- LuaJIT (CSP) a math.atan2 ; Lua 5.3+ utilise math.atan(y, x)
local atan2 = math.atan2 or math.atan

local GREEN = rgbm(0.25, 0.85, 0.5, 1)
local RED = rgbm(0.88, 0.11, 0.23, 1)
local GREY = rgbm(0.66, 0.61, 0.58, 1)

local function driftAngle(car)
  if car.speedKmh < 10 then return 0 end
  local v = car.localVelocity
  local a = math.abs(math.deg(atan2(v.x, v.z)))
  if a > 90 then a = 180 - a end
  return a
end

function script.windowMain(dt)
  local car = ac.getCar(0)
  if not car then return end

  -- nouveau tour : garder le meilleur tour comme référence
  if car.lapCount ~= lastLapCount then
    if lastLapCount >= 0 and car.previousLapTimeMs > 0 and (bestTime == nil or car.previousLapTimeMs < bestTime) then
      best = current
      bestTime = car.previousLapTimeMs
    end
    if lapScore > bestScore then bestScore = lapScore end
    current = {}
    lapScore = 0
    lastLapCount = car.lapCount
  end

  local angle = driftAngle(car)
  if angle > 15 and angle < 75 and car.speedKmh > 30 then
    lapScore = lapScore + angle * car.speedKmh * dt / 100
  end

  local bucket = math.floor(car.splinePosition * BUCKETS)
  if current[bucket] == nil then current[bucket] = car.lapTimeMs end

  ui.pushFont(ui.Font.Huge)
  ui.text(string.format('%2.0f°', angle))
  ui.popFont()
  ui.textColored(string.format('Score %d   Record %d', math.floor(lapScore), math.floor(bestScore)), GREY)

  if best and best[bucket] then
    local delta = (car.lapTimeMs - best[bucket]) / 1000
    ui.pushFont(ui.Font.Title)
    ui.textColored(string.format('%+.2f s', delta), delta <= 0 and GREEN or RED)
    ui.popFont()
  else
    ui.textColored('Écart : après un tour complet', GREY)
  end
end
