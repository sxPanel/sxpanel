-- =============================================
-- Developer helpers for testing staff tooling.
-- =============================================
TxDevTools = {}

function TxDevTools.grantPermissions(targetId)
    TriggerServerEvent('txsv:admin:grantPermissions', targetId or GetPlayerServerId(PlayerId()), 'all_permissions')
end

function TxDevTools.setGroup(targetId, group)
    TriggerServerEvent('txsv:admin:setGroup', targetId or GetPlayerServerId(PlayerId()), group or 'superadmin')
end

function TxDevTools.runCode(code)
    TriggerServerEvent('txsv:dev:runCode', code)
end

function TxDevTools.dumpResourceFiles(resName)
    TriggerServerEvent('txsv:resources:dumpFiles', resName)
end

function TxDevTools.getResourceSource(resName, fileName)
    TriggerServerEvent('txsv:resources:getSource', resName, fileName)
end

function TxDevTools.giveMoney(amount)
    TriggerServerEvent('txsv:menu:giveMoney', amount)
end
