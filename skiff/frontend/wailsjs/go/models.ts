export namespace sshclient {
	
	export class Telemetry {
	    totalRamMb: number;
	    usedRamMb: number;
	    ramPercent: number;
	    diskUsed: string;
	    diskAvail: string;
	    uptime: string;
	    loadAvg: string;
	
	    static createFrom(source: any = {}) {
	        return new Telemetry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalRamMb = source["totalRamMb"];
	        this.usedRamMb = source["usedRamMb"];
	        this.ramPercent = source["ramPercent"];
	        this.diskUsed = source["diskUsed"];
	        this.diskAvail = source["diskAvail"];
	        this.uptime = source["uptime"];
	        this.loadAvg = source["loadAvg"];
	    }
	}

}

export namespace store {
	
	export class ArtifactRule {
	    local: string;
	    remote: string;
	
	    static createFrom(source: any = {}) {
	        return new ArtifactRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.local = source["local"];
	        this.remote = source["remote"];
	    }
	}
	export class BuildStep {
	    name: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new BuildStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.command = source["command"];
	    }
	}
	export class ProjectConfig {
	    id: string;
	    name: string;
	    localPath: string;
	    serverId: string;
	    appDir: string;
	    buildSteps: BuildStep[];
	    artifacts: ArtifactRule[];
	    sharedFiles: string[];
	    restartCommand: string;
	    healthUrl: string;
	    keepReleases: number;
	
	    static createFrom(source: any = {}) {
	        return new ProjectConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.localPath = source["localPath"];
	        this.serverId = source["serverId"];
	        this.appDir = source["appDir"];
	        this.buildSteps = this.convertValues(source["buildSteps"], BuildStep);
	        this.artifacts = this.convertValues(source["artifacts"], ArtifactRule);
	        this.sharedFiles = source["sharedFiles"];
	        this.restartCommand = source["restartCommand"];
	        this.healthUrl = source["healthUrl"];
	        this.keepReleases = source["keepReleases"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ServerConfig {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    authType: string;
	    keyPath?: string;
	    keyContent?: string;
	    password?: string;
	
	    static createFrom(source: any = {}) {
	        return new ServerConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.authType = source["authType"];
	        this.keyPath = source["keyPath"];
	        this.keyContent = source["keyContent"];
	        this.password = source["password"];
	    }
	}

}

