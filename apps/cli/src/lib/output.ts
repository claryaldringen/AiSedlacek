import chalk from 'chalk';
import Table from 'cli-table3';

export function error(msg: string): void {
  console.error(chalk.red(`Chyba: ${msg}`));
}

export function success(msg: string): void {
  console.log(chalk.green(msg));
}

export function info(msg: string): void {
  console.log(chalk.blue(msg));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(msg));
}

export function table(headers: string[], rows: string[][]): void {
  const t = new Table({ head: headers.map((h) => chalk.bold(h)) });
  for (const row of rows) {
    t.push(row);
  }
  console.log(t.toString());
}

export function statusBadge(status: string): string {
  switch (status) {
    case 'done':
    case 'completed':
      return chalk.green('done');
    case 'pending':
      return chalk.yellow('pending');
    case 'processing':
      return chalk.blue('processing');
    case 'error':
      return chalk.red('error');
    case 'blank':
      return chalk.gray('blank');
    default:
      return status;
  }
}
