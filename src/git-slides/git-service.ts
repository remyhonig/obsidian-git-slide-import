/**
 * Git operations wrapper using simple-git
 */

import simpleGit, { type SimpleGit } from 'simple-git';
import type { GitCommit, GitFileChange, CommitFilter } from './types';

export class GitService {
	private git: SimpleGit;
	private repoPath: string;

	constructor(repoPath: string) {
		this.repoPath = repoPath;
		this.git = simpleGit(repoPath);
	}

	/**
	 * Verify this is a valid git repository
	 */
	async isValidRepo(): Promise<boolean> {
		try {
			await this.git.revparse(['--is-inside-work-tree']);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get list of all branches (local and remote)
	 */
	async getBranches(): Promise<string[]> {
		const result = await this.git.branch(['-a']);
		return result.all;
	}

	/**
	 * Get list of local branches
	 */
	async getLocalBranches(): Promise<string[]> {
		const result = await this.git.branchLocal();
		return result.all;
	}

	/**
	 * Get current branch name
	 */
	async getCurrentBranch(): Promise<string> {
		const result = await this.git.branch();
		return result.current;
	}

	/**
	 * Get commit log with optional filters
	 * Returns commits in chronological order (oldest first)
	 */
	async getCommits(filter: CommitFilter): Promise<GitCommit[]> {
		const options: string[] = [
			'--format=%H|%h|%s|%an|%aI',
			`-n${filter.maxCommits || 50}`
		];

		// Add date-based filtering
		if (filter.sinceDate) {
			const sinceStr = filter.sinceDate.toISOString();
			options.push(`--since=${sinceStr}`);
		}

		// Calculate until date based on period
		if (filter.period !== 'present') {
			const untilDate = this.calculateUntilDate(filter.sinceDate, filter.period);
			if (untilDate) {
				options.push(`--until=${untilDate.toISOString()}`);
			}
		}

		// Add branch filter
		if (filter.branch) {
			options.push(filter.branch);
		}

		// Add file path filter if regex provided
		if (filter.fileRegex) {
			options.push('--');
			options.push('.');
		}

		const log = await this.git.raw(['log', ...options]);
		const commits = this.parseLogOutput(log);

		// Filter by file regex if provided
		if (filter.fileRegex) {
			const regex = new RegExp(filter.fileRegex);
			const filteredCommits: GitCommit[] = [];

			for (const commit of commits) {
				const files = await this.getCommitFiles(commit.hash);
				const matchingFiles = files.filter(f => regex.test(f.path));
				if (matchingFiles.length > 0) {
					commit.files = matchingFiles;
					filteredCommits.push(commit);
				}
			}

			// Return in chronological order (oldest first)
			return filteredCommits.reverse();
		}

		// Return in chronological order (oldest first)
		return commits.reverse();
	}

	/**
	 * Calculate the end date based on start date and period
	 */
	private calculateUntilDate(sinceDate: Date | null, period: string): Date | null {
		if (!sinceDate) return null;

		const until = new Date(sinceDate);
		switch (period) {
			case 'day':
				until.setDate(until.getDate() + 1);
				break;
			case 'week':
				until.setDate(until.getDate() + 7);
				break;
			case 'month':
				until.setMonth(until.getMonth() + 1);
				break;
			case 'quarter':
				until.setMonth(until.getMonth() + 3);
				break;
			case 'year':
				until.setFullYear(until.getFullYear() + 1);
				break;
			default:
				return null;
		}
		return until;
	}

	/**
	 * Get files changed in a specific commit
	 */
	async getCommitFiles(commitHash: string): Promise<GitFileChange[]> {
		const result = await this.git.raw([
			'diff-tree', '--no-commit-id', '--name-status', '-r', commitHash
		]);
		return this.parseFileStatus(result);
	}

	/**
	 * Get files changed in a specific commit with stats (additions/deletions)
	 */
	async getCommitFilesWithStats(commitHash: string): Promise<GitFileChange[]> {
		// Get file status
		const statusResult = await this.git.raw([
			'diff-tree', '--no-commit-id', '--name-status', '-r', commitHash
		]);
		const files = this.parseFileStatus(statusResult);

		// Get numstat for additions/deletions
		const statResult = await this.git.raw([
			'diff-tree', '--no-commit-id', '--numstat', '-r', commitHash
		]);

		const statLines = statResult.trim().split('\n').filter(line => line.length > 0);
		const statsMap = new Map<string, { additions: number; deletions: number }>();

		for (const line of statLines) {
			const parts = line.split('\t');
			if (parts.length >= 3) {
				const addStr = parts[0] ?? '0';
				const delStr = parts[1] ?? '0';
				const filePath = parts[2] ?? '';
				const additions = addStr === '-' ? 0 : parseInt(addStr) || 0;
				const deletions = delStr === '-' ? 0 : parseInt(delStr) || 0;
				statsMap.set(filePath, { additions, deletions });
			}
		}

		// Merge stats into files
		for (const file of files) {
			const stats = statsMap.get(file.path);
			if (stats) {
				file.additions = stats.additions;
				file.deletions = stats.deletions;
			}
		}

		return files;
	}

	/**
	 * Get the diff for a specific file in a commit
	 */
	async getFileDiff(
		commitHash: string,
		filePath: string,
		contextLines = 3
	): Promise<string> {
		try {
			return await this.git.raw([
				'diff', `-U${contextLines}`, `${commitHash}^`, commitHash, '--', filePath
			]);
		} catch {
			// For first commit or deleted files, try showing without parent
			return await this.git.raw([
				'show', `--format=`, `-U${contextLines}`, commitHash, '--', filePath
			]);
		}
	}

	/**
	 * Get full file content at a specific commit
	 */
	async getFileContent(commitHash: string, filePath: string): Promise<string | null> {
		try {
			return await this.git.raw(['show', `${commitHash}:${filePath}`]);
		} catch {
			// File was deleted or doesn't exist at this commit
			return null;
		}
	}

	/**
	 * Get commit message (full, including body)
	 */
	async getCommitMessage(commitHash: string): Promise<string> {
		return await this.git.raw(['log', '-1', '--format=%B', commitHash]);
	}

	private parseLogOutput(output: string): GitCommit[] {
		return output.trim().split('\n')
			.filter(line => line.length > 0)
			.map(line => {
				const parts = line.split('|');
				return {
					hash: parts[0] || '',
					hashShort: parts[1] || '',
					message: parts[2] || '',
					author: parts[3] || '',
					date: new Date(parts[4] || ''),
					files: []
				};
			});
	}

	private parseFileStatus(output: string): GitFileChange[] {
		return output.trim().split('\n')
			.filter(line => line.length > 0)
			.map(line => {
				const parts = line.split('\t');
				return {
					path: parts[1] || parts[0] || '',
					status: this.mapStatus(parts[0] || ''),
					additions: 0,
					deletions: 0
				};
			});
	}

	private mapStatus(status: string): GitFileChange['status'] {
		const firstChar = status.charAt(0).toUpperCase();
		const statusMap: Record<string, GitFileChange['status']> = {
			'A': 'added',
			'M': 'modified',
			'D': 'deleted',
			'R': 'renamed'
		};
		return statusMap[firstChar] || 'modified';
	}
}
