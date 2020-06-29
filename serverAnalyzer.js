const fs = require('fs');
const childProcess = require('child_process');
const serverUtil = require('./serverUtil');

const usrDirMgr = serverUtil.usrDirMgr;
const removeDir = serverUtil.removeDir;
const dateTime = serverUtil.dateTime;
const processKillManager = serverUtil.processKillManager;

let runChildProcess = "";
let preRunChildProcess = "";
let timeoutHandel = "";
const serverTimeout = 60000;        //  in milliseconds


// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                   reqToRes
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
exports.reqToRes = function(dirname){
    return function(req, res, next){
        const reqType = req.body.reqType;
        if(reqType === "usrConnect"){
            usrConnect(req, res, next, dirname)
        }else if(reqType === "run"){
            run(req, res, next, dirname);
        }else if(reqType === "abort"){
            abort(req, res, next, dirname, timeoutHandel);
        }else if(reqType === "preRun"){
            preRun(req, res, next, dirname)
        }else if(reqType === "ping"){
            ping(req, res, next, dirname)
        // }else if(reqType === "unload"){
        //     removeUsrDir(req, res, next, dirname)
        }
    }
}

// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%               removeUsrDir
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
const removeUsrDir = function(req, res, next, dirname){
    const dest = usrDirMgr(req, dirname);
    removeDir(dest.usrAbsDirPath);
}

// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                 usrConnect
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
const usrConnect = function(req, res, next, dirname){
    const dest = usrDirMgr(req, dirname);
    if (!fs.existsSync(dest.usrAbsDirPath)) {
        fs.mkdirSync(dest.usrAbsDirPath);
    }

    const dateAndTime = dateTime();
    const rawData = {
      usrIP: req.connection.remoteAddress,
      usrDir: dest.usrDirName,
      date: dateAndTime.date,
      time: dateAndTime.time,
    };

    const dataJson = JSON.stringify(rawData);
    const logFilePath = dirname + "/logs/log.txt";
    fs.appendFile(logFilePath, dataJson, (err) =>{
        if (err) {
            console.log("error in writing log file");
        }
    })
    res.send("UDIC");
}

// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                       ping
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
const ping = function(req, res, next, dirname){
    const dest = usrDirMgr(req, dirname);
    let date = new Date();
    var pingArrivedTime = Math.floor(date.getTime() / 1000).toString();
    const pingFilePath = dest.usrAbsDirPath + "/ping.txt";
    fs.writeFile(pingFilePath, pingArrivedTime, (err) => {
        if(err){
            console.log("error in writing ping file");
        }
    });
}

// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                      abort
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
const abort = function(req, res, next, dirname, timeoutHandel){
    clearTimeout(timeoutHandel);
    (req.body.abortRequestFor === "Run")? runChildProcess.kill() : preRunChildProcess.kill();
    const result = {
        responseType: "Process_Terminated",
        errorType: null,
        errorCode: null,
        response: "Process was terminated on the server for timeout",
    }
    res.send(result);
}

// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                        run
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
const run = function(req, res, next, dirname){
    const dest = usrDirMgr(req, dirname);

    const workspaceId = req.body.workspaceId;
    const workspaceName = req.body.workspaceName;
    const codeFilename = workspaceName + "_" + workspaceId;
    const codeFile = codeFilename + ".asy";
    const codeFilePath = dest.usrAbsDirPath + "/" + codeFile;
    const isUpdated = req.body.isUpdated;
    const outputFileToRemove = dest.usrAbsDirPath + "/" + codeFilename + ".html";

    let runStdoutText = "";
    let preRunStdoutText = "";

    if (fs.existsSync(outputFileToRemove)){
        fs.unlinkSync(outputFileToRemove);
    }

    fs.writeFile(codeFilePath, req.body.codeText, (err) => {
        if (err){
            const result = {
                responseType: "Error",
                errorType: "An error occurred inside the server while writing the asy file to the disk!",
                errorCode: err.code,
                response: err.toString(),
            }
            res.send(result);
        }else{
            const runChildProcessOption = {
                cwd: dest.usrAbsDirPath,
            }
            runChildProcess = childProcess.spawn('asy', ['-noV', '-f', 'html', codeFile], runChildProcessOption);
            timeoutHandel = processKillManager(res, runChildProcess, serverTimeout);;

            runChildProcess.on('error', function (error) {
                clearTimeout(timeoutHandel);
                const result = {
                    responseType: "Error",
                    errorType: "An internal error!",
                    errorCode: error.code,
                    response: error.toString(),
                };
                res.send(result);
            })

            runChildProcess.stdout.on('data', function (chunk) {
                runStdoutText += chunk.toString();
            })

            runChildProcess.stderr.on('data', function (chunk) {
                clearTimeout(timeoutHandel);
                let stderrText = "";
                stderrText += chunk.toString();
                const result = {
                    responseType: "Error",
                    stdoutText: "",
                    errorType: "Stderr",
                    errorCode: "1",
                    response: stderrText,
                };
                res.send(result);
            }) 
            
            runChildProcess.on('exit', function (code) {
                clearTimeout(timeoutHandel);
                if (code === 0){
                    const outputFilePath = dest.usrAbsDirPath + "/" + codeFilename + ".html";
                    if (fs.existsSync(outputFilePath)) {
                        var result = {
                            responseType: "OutputFile_Generated",
                            errorType: null,
                            errorCode: null,
                            response: dest.usrRelDirPath + "/" + codeFilename + ".html",
                            stdoutText: runStdoutText,
                            status: "Output_Saved",
                            isUpdated: !isUpdated
                        };
                    } else {
                        var result = {
                            responseType: "NoOutput_Generated",
                            errorType: null,
                            errorCode: null,
                            response: "",
                            stdoutText: runStdoutText,
                            status: "NoOutput",
                        };
                    }                
                    res.send(result);
                }
            })
        }
    });
}

// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                     preRun
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
const preRun = function(req, res, next, dirname){
    let htmlFileFlag = "";

    const dest = usrDirMgr(req, dirname);
    const workspaceId = req.body.workspaceId;
    const workspaceName = req.body.workspaceName;
    const codeFilename = workspaceName + "_" + workspaceId;
    const codeFile = codeFilename + ".asy";
    const codeFilePath = dest.usrAbsDirPath + "/" + codeFile;
    const requestedOutformat= req.body.requestedOutformat;
    const partialMode = req.body.partialMode;

    const asyFileToRemove = dest.usrAbsDirPath + "/" + codeFilename + ".asy";
    const outputFileToRemove = dest.usrAbsDirPath + "/" + codeFilename + "." + requestedOutformat;
    const existingHtmlFile = dest.usrAbsDirPath + "/" + codeFilename + ".html";
    
    (fs.existsSync(existingHtmlFile))? htmlFileFlag = true : htmlFileFlag = false;

    if(partialMode){
        // console.log("in partial mode")
        fs.writeFile(codeFilePath, req.body.codeText, (err) => {
            if (err){
                // console.log(err);
                const result = {
                    responseType: "Error",
                    errorType: "An error occurred inside the server while writing the asy file to the disk!",
                    errorCode: err.code,
                    response: err.toString(),
                    status: "No-Retry",
                }
                res.send(result);
            }else{
                const result = {
                    responseType: "AsyFile_Generated",
                    errorType: null,
                    errorCode: null,
                    response: "",
                    status: "PreRun_AsyFile_Saved",
                }
                res.send(result);
            }
        });                        
    }else{
        if(requestedOutformat === "html" && htmlFileFlag){
            var result = {
                responseType: "OutputFile_Generated",
                errorType: null,
                errorCode: null,
                response: null,
                status: "PreRun_Output_Saved",
            }
            res.send(result);        
        }else{
            if (fs.existsSync(asyFileToRemove)) {
                fs.unlinkSync(asyFileToRemove);
            }
            if (fs.existsSync(outputFileToRemove)) {
                fs.unlinkSync(outputFileToRemove);
            }
            fs.writeFile(codeFilePath, req.body.codeText, (err) => {
                if (err){
                    // console.log(err);
                    const result = {
                        responseType: "Error",
                        errorType: "An error occurred inside the server while writing asy file to the disk!",
                        errorCode: err.code,
                        response: err.toString(),
                        status: "No-Retry",
                    }
                    res.send(result);
                }else{
                    const preRunChildProcessOption = {
                        cwd: dest.usrAbsDirPath
                    }
                    preRunChildProcess = childProcess.spawn('asy', ['-noV', '-f', requestedOutformat, codeFile], preRunChildProcessOption);
                    timeoutHandel = processKillManager(res, preRunChildProcess, serverTimeout);

                    preRunChildProcess.on('error', function (error) {
                        clearTimeout(timeoutHandel);
                        const result = {
                            responseType: "Error",
                            errorType: "An internal error!",
                            errorCode: error.code,
                            response: error.toString(),
                        };
                        res.send(result);
                    })
                    
                    preRunChildProcess.stdout.on('data', function (chunk) {
                        clearTimeout(timeoutHandel);
                        let stdoutText = "";
                        stdoutText += chunk.toString();
                        const result = {
                            responseType: "Stdout",
                            errorType: null,
                            errorCode: null,
                            response: stdoutText,
                        };
                        res.send(result);
                    })

                    preRunChildProcess.stderr.on('data', function (chunk) {
                        clearTimeout(timeoutHandel);
                        let stderrText = "";
                        stderrText += chunk.toString();
                        const result = {
                            responseType: "Error",
                            errorType: "Stderr",
                            errorCode: "1",
                            response: stderrText,
                        };
                        res.send(result);
                    })

                    preRunChildProcess.on('exit', function (code) {
                        clearTimeout(timeoutHandel);
                        if (code === 0) {
                            const outputFilePath = dest.usrAbsDirPath + "/" + codeFilename + "." + requestedOutformat;
                            if (fs.existsSync(outputFilePath)) {
                                var result = {
                                    responseType: "OutputFile_Generated",
                                    errorType: null,
                                    errorCode: null,
                                    response: null,
                                    status: "PreRun_Output_Saved",
                                }
                            } else {
                                var result = {
                                    responseType: "OutputFile_NotGenerated",
                                    errorType: null,
                                    errorCode: null,
                                    response: "",
                                    status: "PreRun_No_Output",
                                }
                            }
                        }
                        res.send(result);
                    })
                }
            });
        }
    }
}

// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%                downloadReq
// %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
exports.downloadReq = function(dirname){
    return function(req, res, next){
        const dest = usrDirMgr(req, dirname);
        const workspaceId = req.body.workspaceId;
        const workspaceName = req.body.workspaceName;
        const codeOption = req.body.codeOption;
        const outputOption = req.body.outputOption;        
        const codeFilename = workspaceName + "_" + workspaceId;
        const codeFile = codeFilename + ".asy";
        const codeFilePath = dest.usrAbsDirPath + "/" + codeFile;
        const requestedOutformat= req.body.requestedOutformat;
        const outputFile = codeFilename + "." + requestedOutformat;

        if(codeOption){
            // console.log("server: here in only code");
            if(fs.existsSync(codeFilePath)){
                res.download(codeFilePath);
            }
        }
        if(outputOption){
            const outputFilePath = dest.usrAbsDirPath + "/" + outputFile;
            // console.log("server: here in only output");
            if(fs.existsSync(outputFilePath)){
                res.download(outputFilePath);
            }
        }
    }
}
