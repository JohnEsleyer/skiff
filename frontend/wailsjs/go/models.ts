export namespace bootstrap {
	
	export class StackConfig {
	    stackType: string;
	    version: string;
	    dbUser: string;
	    dbPassword: string;
	    dbName: string;
	    surrealStorage: string;
	    enableSwap: boolean;
	    installCaddy: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StackConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stackType = source["stackType"];
	        this.version = source["version"];
	        this.dbUser = source["dbUser"];
	        this.dbPassword = source["dbPassword"];
	        this.dbName = source["dbName"];
	        this.surrealStorage = source["surrealStorage"];
	        this.enableSwap = source["enableSwap"];
	        this.installCaddy = source["installCaddy"];
	    }
	}

}

export namespace main {
	
	export class DNSCheckResult {
	    domain: string;
	    serverIp: string;
	    resolvedIps: string[];
	    isPointing: boolean;
	    isCloudflare: boolean;
	    recordType: string;
	    recordHost: string;
	
	    static createFrom(source: any = {}) {
	        return new DNSCheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.domain = source["domain"];
	        this.serverIp = source["serverIp"];
	        this.resolvedIps = source["resolvedIps"];
	        this.isPointing = source["isPointing"];
	        this.isCloudflare = source["isCloudflare"];
	        this.recordType = source["recordType"];
	        this.recordHost = source["recordHost"];
	    }
	}
	export class DatabaseInfo {
	    engine: string;
	    version?: string;
	    port: number;
	    user: string;
	    password: string;
	    database: string;
	    namespace?: string;
	    storageType: string;
	    dataPath: string;
	    command: string;
	    connectionString: string;
	    surrealistUri?: string;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DatabaseInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.engine = source["engine"];
	        this.version = source["version"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	        this.namespace = source["namespace"];
	        this.storageType = source["storageType"];
	        this.dataPath = source["dataPath"];
	        this.command = source["command"];
	        this.connectionString = source["connectionString"];
	        this.surrealistUri = source["surrealistUri"];
	        this.active = source["active"];
	    }
	}
	export class DeployedAppDetail {
	    name: string;
	    path: string;
	    currentRelease?: string;
	    releasesCount: number;
	    serviceStatus: string;
	    domain?: string;
	
	    static createFrom(source: any = {}) {
	        return new DeployedAppDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.currentRelease = source["currentRelease"];
	        this.releasesCount = source["releasesCount"];
	        this.serviceStatus = source["serviceStatus"];
	        this.domain = source["domain"];
	    }
	}
	export class DomainRouteConfig {
	    appName: string;
	    domain: string;
	    targetPort: number;
	    tlsMode: string;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DomainRouteConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.appName = source["appName"];
	        this.domain = source["domain"];
	        this.targetPort = source["targetPort"];
	        this.tlsMode = source["tlsMode"];
	        this.active = source["active"];
	    }
	}
	export class EndpointProbe {
	    name: string;
	    url: string;
	    ok: boolean;
	    statusCode: number;
	    latencyMs: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new EndpointProbe(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.url = source["url"];
	        this.ok = source["ok"];
	        this.statusCode = source["statusCode"];
	        this.latencyMs = source["latencyMs"];
	        this.error = source["error"];
	    }
	}
	export class ProjectDeploymentStatus {
	    isDeployed: boolean;
	    currentRelease: string;
	    releasesCount: number;
	    serviceActive: boolean;
	    serviceStatus: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectDeploymentStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.isDeployed = source["isDeployed"];
	        this.currentRelease = source["currentRelease"];
	        this.releasesCount = source["releasesCount"];
	        this.serviceActive = source["serviceActive"];
	        this.serviceStatus = source["serviceStatus"];
	    }
	}
	export class ReleaseInfo {
	    id: string;
	    isCurrent: boolean;
	    size: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ReleaseInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.isCurrent = source["isCurrent"];
	        this.size = source["size"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class ServiceStatus {
	    name: string;
	    active: boolean;
	    running: boolean;
	    status: string;
	    version?: string;
	
	    static createFrom(source: any = {}) {
	        return new ServiceStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.active = source["active"];
	        this.running = source["running"];
	        this.status = source["status"];
	        this.version = source["version"];
	    }
	}
	export class ServerOverview {
	    telemetry?: sshclient.Telemetry;
	    services: ServiceStatus[];
	    deployedApps: string[];
	    appDetails: DeployedAppDetail[];
	
	    static createFrom(source: any = {}) {
	        return new ServerOverview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.telemetry = this.convertValues(source["telemetry"], sshclient.Telemetry);
	        this.services = this.convertValues(source["services"], ServiceStatus);
	        this.deployedApps = source["deployedApps"];
	        this.appDetails = this.convertValues(source["appDetails"], DeployedAppDetail);
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

}

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
	    domain?: string;
	    targetPort?: number;
	    tlsMode?: string;
	    buildSteps: BuildStep[];
	    artifacts: ArtifactRule[];
	    sharedFiles: string[];
	    remoteSetupSteps?: BuildStep[];
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
	        this.domain = source["domain"];
	        this.targetPort = source["targetPort"];
	        this.tlsMode = source["tlsMode"];
	        this.buildSteps = this.convertValues(source["buildSteps"], BuildStep);
	        this.artifacts = this.convertValues(source["artifacts"], ArtifactRule);
	        this.sharedFiles = source["sharedFiles"];
	        this.remoteSetupSteps = this.convertValues(source["remoteSetupSteps"], BuildStep);
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

