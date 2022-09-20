let source;
let lastUpdate;
let noCloud = false;

$(document).ready(function() {

	connectSSE();

    setInterval(function() {
        if (source && lastUpdate < Math.floor(Date.now() / 1000) - 30000) {
            // It has been more than 30 seconds since the last update
            console.log('no SSE data for 30 sec, restarting connection');
            source.close();
            source = null;
        }
        if (!source) {
            connectSSE();
        }
    }, 4000);
});


function connectSSE() {
	if (source) {
        return;
    }

    console.log("starting event listener for SSE");
    eventLog = [];
    
    deviceClear();
    $('#logs > pre').html('');

    source = new EventSource("stream");
    source.onerror = function() {
        console.log("SSE event listener error");
        source.close();
        source = null;
    };
    source.onclose = function() {
        console.log("SSE event listener close");
        source = null;
    };
    
    source.addEventListener("message", function(event) {
        // console.log('event.data ' + event.data);
        const obj = JSON.parse('[' + event.data + ']');
        //console.log('obj[0]', obj[0]);
        
        const obj2 = JSON.parse(obj[0]);

        // console.log('obj2', obj2);
        switch(obj2.op) {
            case 'log':
                serverLog(obj2.msg);
                break;

            case 'deviceLog':
                deviceLog(obj2.id, obj2.msg);
                break;
            
            case 'deviceInfo':
                deviceInfo(obj2.id, obj2.info);
                break;

            case 'usbDisconnect':
                deviceClear(obj2.id);
                break;

            case 'setupFailed':
                $(deviceFind(obj2.id, false).elem).addClass('deviceSetupFailed');
                break;

            case 'setupDone':
                $(deviceFind(obj2.id, false).elem).addClass('deviceSetupDone');
                if (!noCloud) {
                    $(deviceFind(obj2.id, false).elem).find('.signalDiv').show();
                }
                break;

            case 'noCloud':
                noCloud = true;
                console.log('no cloud mode');
                break;

            default:
                console.log('unknown sse', obj2);
                break;
        }

        lastUpdate = Math.floor(Date.now() / 1000);
    });

}

function serverLog(msg) {
    const textNode = document.createTextNode(msg + '\n');
    $('#logs > pre').append(textNode);
}


let deviceList = [];

function deviceClear(id) {
    for(let ii = deviceList.length - 1; ii >= 0; ii--) {
        if (!id || deviceList[ii].id == id) {
            $(deviceList[ii].elem).remove();
            deviceList.splice(ii, 1);
        }
    }
}

function deviceFind(id, create) {
    let d = deviceList.find((d) => d.id == id);
    if (!d && create) {
        d = {
            id,
            elem: $('.deviceInfo')[0].cloneNode(true)
        };

        $(d.elem).removeClass('deviceInfo');
        $(d.elem).show();

        $(d.elem).find('.signalButton').on('click', function() {
            const postObj = {
                deviceId: id
            };

            let request = {
                contentType: 'application/json',
                data: JSON.stringify(postObj),
                dataType: 'json',
                error: function (jqXHR) {
                },
                headers: {
                    'Accept': 'application/json'
                },
                method: 'POST',
                success: function (resp, textStatus, jqXHR) {
                },
                url: 'signal'
            }

  

            $.ajax(request);

        });

        $(d.elem).find('.deviceInfoLabel').text(id);

        $('.deviceFlex').append(d.elem);

        deviceList.push(d);
    }
    
    return d;
}

function deviceLog(id, msg) {
    let d = deviceFind(id, true);

    const textNode = document.createTextNode(msg + '\n');
    $(d.elem).find('pre').append(textNode);
}

function deviceInfo(id, deviceInfo) {
    let d = deviceFind(id, false);
    if (!d) {
        return;
    }

    if (deviceInfo.serial_number) {
        $(d.elem).find('.deviceInfoLabel').text(deviceInfo.serial_number);
    }

    //console.log('deviceInfo', deviceInfo);

}