import { Jira, SecurityHub, SecurityHubFinding } from "./libs";
import { Remediation } from "@aws-sdk/client-securityhub";
import { IssueObject } from "jira-client";

interface SecurityHubJiraSyncOptions {
  region?: string;
  severities?: string[];
}

export class SecurityHubJiraSync {
  private readonly jira: Jira;
  private readonly securityHub: SecurityHub;

  constructor(options: SecurityHubJiraSyncOptions = {}) {
    const { region = "us-east-1", severities = ["HIGH", "CRITICAL"] } = options;

    this.securityHub = new SecurityHub({ region, severities });
    this.jira = new Jira();
  }

  async sync() {
    // Step 1. Get all open Security Hub issues from Jira
    const jiraIssues = await this.jira.getAllSecurityHubIssuesInJiraProject();

    // console.log(
    //   "all current statuses on security hub issues:",
    //   new Set(jiraIssues.map((i) => i.fields.status.name))
    // );

    // Step 2. Get all current findings from Security Hub
    const shFindings = await this.securityHub.getAllActiveFindings();

    // Step 3. Close existing Jira issues if their finding is no longer active/current
    this.closeIssuesForResolvedFindings(jiraIssues, shFindings);

    // Step 4. Create Jira issue for current findings that do not already have a Jira issue
    this.createJiraIssuesForNewFindings(jiraIssues, shFindings);
  }

  closeIssuesForResolvedFindings(
    jiraIssues: IssueObject[],
    shFindings: SecurityHubFinding[]
  ) {
    const expectedJiraIssueTitles = Array.from(
      new Set(
        shFindings.map((finding) => `SecurityHub Finding - ${finding.title}`)
      )
    );

    // close all security-hub labeled Jira issues that do not have an active finding
    jiraIssues.forEach((issue) => {
      if (!expectedJiraIssueTitles.includes(issue.fields.summary)) {
        this.jira.closeIssue(issue.key);
      }
    });
  }

  createIssueBody(finding: SecurityHubFinding) {
    const {
      remediation: {
        Recommendation: {
          Url: remediationUrl = "",
          Text: remediationText = "",
        } = {},
      } = {},
      title = "",
      description = "",
      accountAlias = "",
      awsAccountId = "",
      severity = "",
      standardsControlArn = "",
    } = finding;

    return `----

      *This issue was generated from Security Hub data and is managed through automation.*
      Please do not edit the title or body of this issue, or remove the security-hub tag.  All other edits/comments are welcome.
      Finding Title: ${title}

      ----

      h2. Type of Issue:

      * Security Hub Finding

      h2. Title:

      ${title}

      h2. Description:

      ${description}

      h2. Remediation:

      ${remediationUrl}
      ${remediationText}

      h2. AWS Account:
      ${awsAccountId} (${accountAlias})

      h2. Severity:
      ${severity}

      h2. SecurityHubFindingUrl:
      ${this.createSecurityHubFindingUrl(standardsControlArn)}

      h2. AC:

      * All findings of this type are resolved or suppressed, indicated by a Workflow Status of Resolved or Suppressed.  (Note:  this ticket will automatically close when the AC is met.)`;
  }

  createSecurityHubFindingUrl(standardsControlArn = "") {
    if (!standardsControlArn) {
      return "";
    }

    const [
      ,
      partition,
      ,
      region,
      ,
      ,
      securityStandards,
      ,
      securityStandardsVersion,
      controlId,
    ] = standardsControlArn.split(/[/:]+/);
    return `https://${region}.console.${partition}.amazon.com/securityhub/home?region=${region}#/standards/${securityStandards}-${securityStandardsVersion}/${controlId}`;
  }

  async createJiraIssueFromFinding(finding: SecurityHubFinding) {
    const newIssueData = {
      fields: {
        summary: `SecurityHub Finding - ${finding.title}`,
        description: this.createIssueBody(finding),
        issuetype: { name: "Task" },
        labels: [
          "security-hub",
          finding.region,
          finding.severity,
          finding.accountAlias,
          finding.awsAccountId,
        ],
      },
    };
    const newIssueInfo = await this.jira.createNewIssue(newIssueData);
    console.log("new Jira issue created:", newIssueInfo);
  }

  createJiraIssuesForNewFindings(
    jiraIssues: IssueObject[],
    shFindings: SecurityHubFinding[]
  ) {
    const existingJiraIssueTitles = jiraIssues.map((i) => i.fields.summary);
    const uniqueSecurityHubFindings = [
      ...new Set(shFindings.map((finding) => JSON.stringify(finding))),
    ].map((finding) => JSON.parse(finding));

    uniqueSecurityHubFindings
      .filter(
        (finding) =>
          !existingJiraIssueTitles.includes(
            `SecurityHub Finding - ${finding.title}`
          )
      )
      .forEach((finding) => this.createJiraIssueFromFinding(finding));
  }
}