local Wait = Citizen.Wait
local vector3 = vector3
local IsPauseMenuActive = IsPauseMenuActive
local GetSmartControlNormal = GetSmartControlNormal

local SETTINGS = _G.CONTROL_SETTINGS
local CONTROLS = _G.CONTROL_MAPPING

-------------------------------------------------------------------------------
-- Mouse wheel speed multiplier, kept between noclip sessions
local scrollSpeed = 1.0
local scrollSpeedShownUntil = 0
local SCROLL_SPEED_DISPLAY_MS = 1500

local function UpdateScrollSpeed()
  -- Block weapon/radio switching so the wheel only affects noclip
  for _, control in ipairs(CONTROLS.WHEEL_CONFLICTS) do
    DisableControlAction(0, control, true)
  end

  local step = SETTINGS.SCROLL_SPEED_STEP
  local newSpeed = scrollSpeed
  if IsDisabledControlJustPressed(0, CONTROLS.SPEED_UP) then
    newSpeed = newSpeed * step
  end
  if IsDisabledControlJustPressed(0, CONTROLS.SPEED_DOWN) then
    newSpeed = newSpeed / step
  end
  newSpeed = Clamp(newSpeed, SETTINGS.SCROLL_SPEED_MIN, SETTINGS.SCROLL_SPEED_MAX)

  if newSpeed ~= scrollSpeed then
    scrollSpeed = newSpeed
    scrollSpeedShownUntil = GetGameTimer() + SCROLL_SPEED_DISPLAY_MS
  end
end

local function DrawScrollSpeed()
  if not IS_FIVEM or GetGameTimer() > scrollSpeedShownUntil then
    return
  end
  SetTextFont(4)
  SetTextScale(0.0, 0.5)
  SetTextColour(255, 255, 255, 230)
  SetTextOutline()
  SetTextCentre(true)
  BeginTextCommandDisplayText('STRING')
  local label = GetInstructionalLabel('noclip_speed_value', 'Speed: x%{speed}')
  local speedText = ('%.2f'):format(scrollSpeed)
  AddTextComponentSubstringPlayerName((label:gsub('%%{speed}', speedText)))
  EndTextCommandDisplayText(0.5, 0.85)
end

local function GetSpeedMultiplier()
  local fastNormal = GetSmartControlNormal(CONTROLS.MOVE_FAST)
  local slowNormal = GetSmartControlNormal(CONTROLS.MOVE_SLOW)

  local baseSpeed = SETTINGS.BASE_MOVE_MULTIPLIER
  local slowSpeed = 1 + ((SETTINGS.SLOW_MOVE_MULTIPLIER - 1) * slowNormal)
  -- Slow overrides any speed boost (fast key and scroll above x1), so it always slows down
  local fastSpeed = 1 + ((SETTINGS.FAST_MOVE_MULTIPLIER - 1) * fastNormal * (1 - slowNormal))
  local scrollBoost = scrollSpeed
  if scrollSpeed > 1 then
    scrollBoost = scrollSpeed + ((1 - scrollSpeed) * slowNormal)
  end

  local frameMultiplier = GetFrameTime() * 60
  local speedMultiplier = baseSpeed * scrollBoost * fastSpeed / slowSpeed

  return speedMultiplier * frameMultiplier
end

local function UpdateCamera()
  if not IsFreecamActive() or IsPauseMenuActive() then
    return
  end

  if not IsFreecamFrozen() then
    UpdateScrollSpeed()
    DrawScrollSpeed()

    local vecX, vecY = GetFreecamMatrix()
    local vecZ = vector3(0, 0, 1)

    local pos = GetFreecamPosition()
    local rot = GetFreecamRotation()

    -- Get speed multiplier for movement
    local speedMultiplier = GetSpeedMultiplier()

    -- Get rotation input
    local lookX = GetSmartControlNormal(CONTROLS.LOOK_X)
    local lookY = GetSmartControlNormal(CONTROLS.LOOK_Y)

    -- Get position input
    local moveX = GetSmartControlNormal(CONTROLS.MOVE_X)
    local moveY = GetSmartControlNormal(CONTROLS.MOVE_Y)
    local moveZ = GetSmartControlNormal(CONTROLS.MOVE_Z)

    -- Calculate new rotation.
    ---@diagnostic disable-next-line: need-check-nil
    local rotX = rot.x + (-lookY * SETTINGS.LOOK_SENSITIVITY_X)
    ---@diagnostic disable-next-line: need-check-nil
    local rotZ = rot.z + (-lookX * SETTINGS.LOOK_SENSITIVITY_Y)
    ---@diagnostic disable-next-line: need-check-nil
    local rotY = rot.y

    -- Adjust position relative to camera rotation.
    pos = pos + (vecX *  moveX * speedMultiplier)
    pos = pos + (vecY * -moveY * speedMultiplier)
    pos = pos + (vecZ *  moveZ * speedMultiplier)

    -- Adjust new rotation
    rot = vector3(rotX, rotY, rotZ)

    -- Update camera
    SetFreecamPosition(pos.x, pos.y, pos.z)
    SetFreecamRotation(rot.x, rot.y, rot.z)

    return pos, rotZ
  end

  -- Trigger a tick event. Resources depending on the freecam position can
  -- make use of this event.
  -- TriggerEvent('freecam:onTick')
end

-------------------------------------------------------------------------------
local function buildFreecamKeysTable()
  return {
    {GetInstructionalLabel('noclip_speed', 'Speed'), CONTROLS.SPEED_UP},
    {GetInstructionalLabel('noclip_slower', 'Slower'), CONTROLS.MOVE_SLOW},
    {GetInstructionalLabel('noclip_faster', 'Faster'), CONTROLS.MOVE_FAST},
    {GetInstructionalLabel('noclip_down', 'Down'), CONTROLS.MOVE_Z[2]},
    {GetInstructionalLabel('noclip_up', 'Up'), CONTROLS.MOVE_Z[1]},
    {GetInstructionalLabel('noclip_left_right', 'Left/Right'), CONTROLS.MOVE_X},
    {GetInstructionalLabel('noclip_fwd_back', 'Fwd/Back'), CONTROLS.MOVE_Y},
  }
end
local redmInstructionGroup, redmPromptTitle


function StartFreecamThread()
  if IS_REDM then
    ---@diagnostic disable-next-line: undefined-global
    redmPromptTitle = CreateVarString(10, 'LITERAL_STRING', GetInstructionalLabel('noclip_title', 'NoClip'))
    redmInstructionGroup = makeRedmInstructionalGroup(buildFreecamKeysTable())
  end
  -- Camera/Pos updating thread
  Citizen.CreateThread(function()
    local ped = PlayerPedId()
    local initialPos = GetEntityCoords(ped)
    SetFreecamPosition(initialPos[1], initialPos[2], initialPos[3])
    local veh = GetVehiclePedIsIn(ped, false)
    if IsPedOnMount(ped) then
      veh = GetMount(ped)
    end

    local function updatePos(pos, rotZ)
      if pos ~= nil and rotZ ~= nil then
        -- Update ped
        SetEntityCoords(ped, pos.x, pos.y, pos.z, false, false, false, false)
        SetEntityHeading(ped, rotZ)
        -- Update veh
        if veh and veh > 0 and DoesEntityExist(veh) then
          SetEntityCoords(veh, pos.x, pos.y, pos.z, false, false, false, false)
          SetEntityHeading(veh, rotZ)
        end
      end
    end

    local frameCounter = 0
    local loopPos, loopRotZ
    while IsFreecamActive() do
      loopPos, loopRotZ = UpdateCamera()
      frameCounter = frameCounter + 1
      if frameCounter > 100 then
        frameCounter = 0
        updatePos(loopPos, loopRotZ)
      end
      Wait(0)
    end

    -- One last time due to the optimization
    updatePos(loopPos, loopRotZ)
  end)

  -- Start instructional thread
  CreateThread(function()
    local fivemScaleform = IS_FIVEM and makeFivemInstructionalScaleform(buildFreecamKeysTable())
    while IsFreecamActive() do
      if IS_FIVEM then
        ---@diagnostic disable-next-line: param-type-mismatch
        DrawScaleformMovieFullscreen(fivemScaleform, 255, 255, 255, 255, 0)
      else
        ---@diagnostic disable-next-line: undefined-global
        PromptSetActiveGroupThisFrame(redmInstructionGroup.groupId, redmPromptTitle, 1, 0, 0, 0)
      end
      Wait(0)
    end

    --cleanup of the scaleform movie
    if IS_FIVEM then
      ---@diagnostic disable-next-line: param-type-mismatch
      SetScaleformMovieAsNoLongerNeeded(fivemScaleform)
    end
  end)
end

--------------------------------------------------------------------------------

-- When the resource is stopped, make sure to return the camera to the player.
AddEventHandler('onResourceStop', function (resourceName)
  if resourceName == GetCurrentResourceName() then
    SetFreecamActive(false)
  end
end)
