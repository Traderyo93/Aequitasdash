import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import time, timedelta, datetime
import requests
import pytz
import os
from tqdm import tqdm
from time import sleep
import random
import logging
import traceback
from typing import List, Dict, Tuple
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from scipy import stats
import json
import glob
import argparse
import sys

# Set up matplotlib to use 'Agg' backend
import matplotlib
matplotlib.use('Agg')

def parse_arguments():
    parser = argparse.ArgumentParser(description='Run backtest with date range')
    parser.add_argument('--from-date', required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--to-date', required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--starting-balance', type=float, default=100000, help='Starting balance')
    parser.add_argument('--output-format', choices=['json', 'text'], default='text', help='Output format')
    return parser.parse_args()

# ============================================================================
# CONFIGURATION SECTION
# ============================================================================

current_dir = r'C:\Users\maxma\OneDrive\Desktop\Algo Tests'
charts_dir = os.path.join(current_dir, 'trade_charts')
os.makedirs(charts_dir, exist_ok=True)

# Parse command line arguments
args = parse_arguments()

# Use command line arguments instead of hardcoded values
START_DATE = args.from_date
END_DATE = args.to_date
initial_account_size = args.starting_balance
output_format = args.output_format

# Override the existing date configuration
RUN_SINGLE_DATE = False  # Always run date range when using CLI args
TARGET_DATE = args.from_date  # Not used when RUN_SINGLE_DATE is False

# Strategy Parameters
commission_percentage = 0.4

# Set up cache directory
cache_dir = os.path.join(current_dir, 'data_cache')
os.makedirs(cache_dir, exist_ok=True)

# API Configuration
POLYGON_BASE_URL = "https://api.polygon.io/v2"
POLYGON_API_KEY = 'sDIe8y1lqhxDe971hDpZlXoxzdw1poKM'

# Gapper strategy parameters
risk_percentage_trade1 = 4
risk_percentage_trade2 = 2.75
min_share_price = 0.3
min_gap_percentage = 50
max_pmh_to_open_drop = 40

# Position Sizing Configuration
USE_STATIC_POSITION_SIZING = True
USE_STATIC_POSITION_SIZING_INTRADAY = True
STATIC_RISK_AMOUNT_GAPPER_1 = 1000
STATIC_RISK_AMOUNT_GAPPER_2 = 1000
STATIC_RISK_AMOUNT_BACKSIDE = 2000
STATIC_RISK_AMOUNT_INTRADAY = 1500
BACKSIDE_STOP_LOSS_PERCENT = 0.40
BACKSIDE_RISK_PERCENTAGE = 0.0675

# Match Mac version's constants
PRE_MARKET_HIGH_VIOLATION_PERCENT = 27.0

# Parameters for trade skipping and slippage
skip_trade_probability = 0
slippage_probability = 100
min_slippage_percentage = 0.66
max_slippage_percentage = 0.66

# Partial fill parameters
partial_fill_frequency = 10
partial_fill_min_percentage = 100
partial_fill_max_percentage = 100

# Backside strategy constants
PREVIOUS_CLOSE_MIN = 0.1
PREVIOUS_CLOSE_MAX = 6.0
MIN_OVERALL_MOVE_PERCENT = 80
MIN_EXTENSION_PERCENT = 40
EXTENSION_OCCURS_WITHIN_BARS = 30
MIN_PULLBACK_PERCENT = 15
PULLBACK_OCCURS_WITHIN_BARS = 30
PULLBACK_HOLD_TIME_BARS = 6
MAX_BAR_VOLUME_DAY = 2200000
MAX_BAR_VOLUME_PM = 1100000
MAX_TOTAL_VOLUME_PM = 20000000
TRIGGER_EXCLUSION_1_MIN = 0.00
TRIGGER_EXCLUSION_1_MAX = 0.46
TRIGGER_EXCLUSION_2_MIN = 12.00
TRIGGER_EXCLUSION_2_MAX = 999.00
MIN_RUN_TIME_BARS = 7
VOLUME_MAX = 199000000
VOLUME_MIN = 100000
TIME_OF_DAY_MAX = 1430
TIME_OF_DAY_MIN = 600

# Intraday Backside Parameters
INTRADAY_BACKSIDE_PARAMS = {
    'MIN_PRICE_MOVE_PERCENT': 70,
    'MIN_VOLUME': 500000,
    'RISK_PERCENTAGE': 5.0,
    'STOP_LOSS_PERCENT': 0.4,
    'PREVIOUS_CLOSE_MIN': 0.1,
    'PREVIOUS_CLOSE_MAX': 6.0,
    'MIN_OVERALL_MOVE_PERCENT': 80,
    'MIN_EXTENSION_PERCENT': 40,
    'EXTENSION_OCCURS_WITHIN_BARS': 30,
    'MIN_PULLBACK_PERCENT': 15,
    'PULLBACK_OCCURS_WITHIN_BARS': 30,
    'PULLBACK_HOLD_TIME_BARS': 6,
    'MAX_BAR_VOLUME_DAY': 2200000,
    'MAX_BAR_VOLUME_PM': 1100000,
    'MAX_TOTAL_VOLUME_PM': 20000000,
    'MIN_RUN_TIME_BARS': 7,
    'VOLUME_MAX': 199000000,
    'VOLUME_MIN': 100000,
    'TIME_OF_DAY_MAX': 1430,
    'TIME_OF_DAY_MIN': 600
}

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def initialize_caching_system():
    if not os.path.exists(cache_dir):
        os.makedirs(cache_dir)
        logging.info(f"Created cache directory: {cache_dir}")
    
    cache_files = os.listdir(cache_dir)
    total_cache_files = len(cache_files)
    cache_size_mb = sum(os.path.getsize(os.path.join(cache_dir, f)) for f in cache_files) / (1024 * 1024)
    
    logging.info(f"Cache initialized: {total_cache_files} files, {cache_size_mb:.2f} MB")
    
    return {
        'total_count': total_cache_files,
        'size_mb': cache_size_mb
    }

def apply_slippage(price, is_entry, is_short=True):
    if random.randint(1, 100) <= slippage_probability:
        slippage_percent = random.uniform(min_slippage_percentage, max_slippage_percentage) / 100
        
        if is_short:
            if is_entry:
                return price * (1 - slippage_percent)
            else:
                return price * (1 + slippage_percent)
        else:
            if is_entry:
                return price * (1 + slippage_percent)
            else:
                return price * (1 - slippage_percent)
    
    return price

def calculate_position_size(account_balance: float, entry_price: float, stop_loss_percent: float, strategy: str = 'Backside') -> int:
    if USE_STATIC_POSITION_SIZING:
        if strategy == 'Gapper1':
            risk_amount = STATIC_RISK_AMOUNT_GAPPER_1
        elif strategy == 'Gapper2':
            risk_amount = STATIC_RISK_AMOUNT_GAPPER_2
        else:  
            risk_amount = STATIC_RISK_AMOUNT_BACKSIDE
    else:
        if strategy == 'Gapper1':
            risk_amount = account_balance * (risk_percentage_trade1 / 100)
        elif strategy == 'Gapper2':
            risk_amount = account_balance * (risk_percentage_trade2 / 100)
        else:
            risk_amount = account_balance * BACKSIDE_RISK_PERCENTAGE

    stop_loss_amount = entry_price * stop_loss_percent
    shares = int(risk_amount / stop_loss_amount)
    return shares

def calculate_commission(trade_value: float) -> float:
    return trade_value * (commission_percentage / 100)

def filter_ticker_symbols(ticker):
    """
    Filter out invalid ticker symbols while being more precise about warrant detection.
    
    Args:
        ticker (str): The ticker symbol to validate
        
    Returns:
        bool: True if ticker should be included, False if it should be filtered out
    """
    
    # Filter out tickers that are too long (likely not standard stocks)
    if len(ticker) >= 5:
        return False
    
    # More specific warrant detection patterns
    # Only filter WS if it's clearly a warrant (ticker length > 4 characters)
    if ticker.endswith('WS') and len(ticker) > 4:
        return False
        
    # Filter out other known warrant/rights suffixes
    if ticker.endswith(('RT', 'WSA')):
        return False
    
    # Filter out known problematic test tickers
    if ticker in ['ZVZZT', 'ZWZZT', 'ZBZZT']:
        return False
    
    return True

# ============================================================================
# DATA FETCHING FUNCTIONS
# ============================================================================

def calculate_daily_return(trades_df, starting_balance):
    """Calculate the daily return percentage from backtest results"""
    try:
        if trades_df.empty:
            return 0.0
        
        # Calculate final account value
        total_pnl = trades_df['profit_loss'].sum()
        final_account_value = starting_balance + total_pnl
        
        # Calculate daily return
        daily_return = ((final_account_value - starting_balance) / starting_balance) * 100
        return daily_return
    
    except Exception as e:
        print(f"Error calculating daily return: {e}", file=sys.stderr)
        return 0.0

def output_json_results(trades_df, daily_return, starting_balance):
    """Output results in JSON format for Node.js consumption"""
    try:
        if trades_df.empty:
            output = {
                'success': True,
                'daily_return_percent': 0.0,
                'starting_balance': starting_balance,
                'final_account_value': starting_balance,
                'total_gross_profit': 0.0,
                'total_net_profit': 0.0,
                'total_commission': 0.0,
                'gapper_strategy_profit': 0.0,
                'backside_strategy_profit': 0.0,
                'intraday_backside_profit': 0.0,
                'gapper_win_rate': 0.0,
                'backside_win_rate': 0.0,
                'intraday_win_rate': 0.0,
                'max_drawdown': 0.0,
                'final_percentage_gain': 0.0
            }
        else:
            # Calculate totals
            total_net_profit = trades_df['profit_loss'].sum()
            total_commission = trades_df['commission'].sum()
            total_gross_profit = total_net_profit + total_commission
            final_account_value = starting_balance + total_net_profit
            
            # Calculate strategy-specific profits
            gapper_trades = trades_df[trades_df['strategy'] == 'Gapper']
            backside_trades = trades_df[trades_df['strategy'] == 'Backside']
            intraday_trades = trades_df[trades_df['strategy'] == 'Intraday Backside']
            
            gapper_profit = gapper_trades['profit_loss'].sum() if not gapper_trades.empty else 0.0
            backside_profit = backside_trades['profit_loss'].sum() if not backside_trades.empty else 0.0
            intraday_profit = intraday_trades['profit_loss'].sum() if not intraday_trades.empty else 0.0
            
            # Calculate win rates
            gapper_win_rate = (gapper_trades['profit_loss'] > 0).mean() if not gapper_trades.empty else 0.0
            backside_win_rate = (backside_trades['profit_loss'] > 0).mean() if not backside_trades.empty else 0.0
            intraday_win_rate = (intraday_trades['profit_loss'] > 0).mean() if not intraday_trades.empty else 0.0
            
            # Calculate max drawdown
            equity_curve = calculate_equity_curve(trades_df)
            drawdown = calculate_drawdown(equity_curve)
            max_drawdown = drawdown.min() if not drawdown.empty else 0.0
            
            output = {
                'success': True,
                'daily_return_percent': daily_return,
                'starting_balance': starting_balance,
                'final_account_value': final_account_value,
                'total_gross_profit': total_gross_profit,
                'total_net_profit': total_net_profit,
                'total_commission': total_commission,
                'gapper_strategy_profit': gapper_profit,
                'backside_strategy_profit': backside_profit,
                'intraday_backside_profit': intraday_profit,
                'gapper_win_rate': gapper_win_rate,
                'backside_win_rate': backside_win_rate,
                'intraday_win_rate': intraday_win_rate,
                'max_drawdown': max_drawdown,
                'final_percentage_gain': daily_return
            }
        
        print(json.dumps(output))
        
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))


def fetch_daily_open_price(ticker: str, date_str: str) -> float | None:
    cache_file = os.path.join(cache_dir, f"{ticker}_{date_str}_daily_open.txt")

    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r') as f:
                return float(f.read().strip())
        except Exception:
            pass

    url = f"{POLYGON_BASE_URL}/aggs/ticker/{ticker}/range/1/day/{date_str}/{date_str}?adjusted=false&sort=asc&limit=1&apiKey={POLYGON_API_KEY}"

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        if data.get('resultsCount', 0) > 0 and 'results' in data and data['results']:
            daily_open = data['results'][0].get('o')
            if daily_open is not None:
                with open(cache_file, 'w') as f:
                    f.write(str(daily_open))
                sleep(0.12)
                return float(daily_open)
            
    except Exception as e:
        logging.error(f"Error fetching daily open for {ticker} on {date_str}: {e}")
        
    return None

def get_previous_trading_day(date):
    eastern = pytz.timezone('US/Eastern')
    if date.tzinfo is None:
        date = eastern.localize(date)
    
    date_str = date.strftime('%Y-%m-%d')
    cache_file = os.path.join(cache_dir, f"prev_trading_day_{date_str}.txt")
    
    if os.path.exists(cache_file):
        with open(cache_file, 'r') as f:
            prev_date_str = f.read().strip()
            return datetime.strptime(prev_date_str, '%Y-%m-%d').replace(tzinfo=eastern)
    
    previous_day = date - timedelta(days=1)
    max_attempts = 10
    
    for _ in range(max_attempts):
        prev_date_str = previous_day.strftime('%Y-%m-%d')
        url = f"{POLYGON_BASE_URL}/aggs/grouped/locale/us/market/stocks/{prev_date_str}?adjusted=false&apiKey={POLYGON_API_KEY}"
        
        try:
            response = requests.get(url)
            data = response.json()
            
            if 'results' in data and data['results']:
                with open(cache_file, 'w') as f:
                    f.write(prev_date_str)
                return previous_day
            
            previous_day -= timedelta(days=1)
            
        except Exception:
            previous_day -= timedelta(days=1)
    
    return None

def fetch_previous_close(symbol: str, date: datetime) -> float:
    try:
        eastern = pytz.timezone('US/Eastern')
        if not isinstance(date, datetime):
            date = pd.to_datetime(date)
        
        if date.tzinfo is None:
            date = eastern.localize(date)
        
        date_str = date.strftime('%Y-%m-%d')
        cache_file = os.path.join(cache_dir, f"{symbol}_prev_close_{date_str}.txt")
        
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f:
                return float(f.read().strip())

        previous_close = None
        previous_day = date - timedelta(days=1)
        max_attempts = 10

        for _ in range(max_attempts):
            previous_close_url = f"{POLYGON_BASE_URL}/aggs/ticker/{symbol}/range/1/day/{previous_day.strftime('%Y-%m-%d')}/{previous_day.strftime('%Y-%m-%d')}?adjusted=false&sort=asc&limit=1&apiKey={POLYGON_API_KEY}"
            response = requests.get(previous_close_url)
            response.raise_for_status()
            previous_close_data = response.json()
            
            if 'results' in previous_close_data and previous_close_data['results']:
                previous_close = previous_close_data['results'][0]['c']
                
                with open(cache_file, 'w') as f:
                    f.write(str(previous_close))
                
                break
            else:
                previous_day -= timedelta(days=1)
        
        return previous_close

    except Exception as e:
        logging.error(f"Error fetching previous close for {symbol} on {date}: {str(e)}")
        return None

def fetch_intraday_data(ticker: str, date: str) -> List[Dict]:
    if ticker in ['ZVZZT', 'ZWZZT', 'ZBZZT']:
        return None
        
    cache_file = os.path.join(cache_dir, f"{ticker}_{date}_intraday.csv")
    
    if os.path.exists(cache_file):
        logging.info(f"CACHE HIT: Loading {ticker} data for {date} from cache")
        df = pd.read_csv(cache_file)
        if not df.empty:
            return df.to_dict('records')
    else:
        logging.info(f"CACHE MISS: Fetching {ticker} data for {date} from API")
    
    max_retries = 3
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            url = f"{POLYGON_BASE_URL}/aggs/ticker/{ticker}/range/1/minute/{date}/{date}?adjusted=false&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}"
            response = requests.get(url)
            response.raise_for_status()
            data = response.json()
            
            if 'results' in data and data['results']:
                df = pd.DataFrame(data['results'])
                if not df.empty and all(col in df.columns for col in ['t', 'o', 'h', 'l', 'c', 'v']):
                    df.to_csv(cache_file, index=False)
                    sleep(0.25)
                    return data['results']
            
            return None
                
        except (requests.exceptions.ConnectionError, requests.exceptions.ReadTimeout) as e:
            if attempt < max_retries - 1:
                retry_time = retry_delay * (attempt + 1)
                sleep(retry_time)
            else:
                logging.error(f"Failed to fetch {ticker} after {max_retries} attempts")
        except Exception:
            break
    
    return None

def preprocess_data(data):
    try:
        if data is None:
            return None
            
        if isinstance(data, list):
            df = pd.DataFrame(data)
        else:
            df = data.copy()
            
        if df.empty:
            return None
        
        try:
            if 't' in df.columns:
                if df['t'].dtype == 'object':
                    df['t'] = pd.to_numeric(df['t'], errors='coerce')
                
                if pd.api.types.is_numeric_dtype(df['t']):
                    df['t'] = pd.to_datetime(df['t'], unit='ms')
                else:
                    df['t'] = pd.to_datetime(df['t'])
        except Exception:
            return None
        
        eastern = pytz.timezone('US/Eastern')
        if df['t'].dt.tz is None:
            df['t'] = df['t'].dt.tz_localize('UTC').dt.tz_convert(eastern)
        elif df['t'].dt.tz != eastern:
            df['t'] = df['t'].dt.tz_convert(eastern)
            
        df = df[
            ((df['t'].dt.time >= time(4, 0)) & (df['t'].dt.time < time(9, 30))) |  
            ((df['t'].dt.time >= time(9, 28)) & (df['t'].dt.time <= time(16, 0)))
        ].reset_index(drop=True)
        
        df['cumulative_volume'] = df['v'].cumsum()
        
        return df
        
    except Exception:
        return None

def calculate_pre_market_high(df):
    try:
        if df is None or df.empty:
            return None
            
        if isinstance(df['t'].iloc[0], (int, float)):
            df = df.copy()
            df['t'] = pd.to_datetime(df['t'], unit='ms')
            
        eastern = pytz.timezone('US/Eastern')
        if df['t'].dt.tz is None:
            df['t'] = df['t'].dt.tz_localize('UTC').dt.tz_convert(eastern)
        elif df['t'].dt.tz != eastern:
            df['t'] = df['t'].dt.tz_convert(eastern)
            
        pre_market_data = df[
            (df['t'].dt.time >= time(4, 0)) & 
            (df['t'].dt.time < time(9, 30))
        ]
        
        if not pre_market_data.empty:
            return pre_market_data['h'].max()
        else:
            return None
            
    except Exception:
        return None

def get_accurate_day_open(market_hours_data: List[Dict], ticker: str, date_for_api: datetime, candidate_details: Dict = None) -> Tuple[float | None, time | None]:
    if not market_hours_data:
        api_open = fetch_daily_open_price(ticker, date_for_api.strftime('%Y-%m-%d'))
        if api_open is not None:
            return api_open, time(9, 30)
        return None, None

    eastern = pytz.timezone('US/Eastern')
    market_open_time_threshold = time(9, 30)
    max_acceptable_start_time = time(9, 35)

    first_candle_found = None
    first_candle_time_dt = None

    for candle in market_hours_data:
        try:
            ts = candle.get('t')
            if ts is None: 
                continue

            if isinstance(ts, (int, float)):
                current_time_dt = pd.to_datetime(ts, unit='ms', utc=True).tz_convert(eastern)
            elif isinstance(ts, str):
                current_time_dt = pd.to_datetime(ts).tz_convert(eastern)
            elif isinstance(ts, pd.Timestamp):
                if ts.tzinfo is None: 
                    current_time_dt = ts.tz_localize('UTC').tz_convert(eastern)
                elif ts.tzinfo.zone != 'US/Eastern': 
                    current_time_dt = ts.tz_convert(eastern)
                else: 
                    current_time_dt = ts
            else: 
                continue

            current_time_obj = current_time_dt.time()

            if current_time_obj >= market_open_time_threshold:
                first_candle_found = candle
                first_candle_time_dt = current_time_dt
                break

        except Exception:
            continue

    if first_candle_found:
        day_open_from_candle = first_candle_found.get('o')
        open_candle_time_obj = first_candle_time_dt.time() if first_candle_time_dt else None

        if day_open_from_candle is not None and open_candle_time_obj is not None:
            if open_candle_time_obj <= max_acceptable_start_time:
                return day_open_from_candle, open_candle_time_obj

    # API Fallback
    api_open = fetch_daily_open_price(ticker, date_for_api.strftime('%Y-%m-%d'))
    if api_open is not None:
        return api_open, time(9, 30)
        
    return None, None

# ============================================================================
# CACHING FUNCTIONS
# ============================================================================

def cache_daily_candidates(date_str, candidates_dict):
    cache_file = os.path.join(cache_dir, f"candidates_{date_str}.json")
    
    try:
        def convert_to_serializable(obj):
            if isinstance(obj, (np.integer, np.int64, np.int32)):
                return int(obj)
            elif isinstance(obj, (np.floating, np.float64, np.float32)):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            elif isinstance(obj, pd.Timestamp):
                return obj.isoformat()
            elif hasattr(obj, 'isoformat'):
                return obj.isoformat()
            elif isinstance(obj, dict):
                return {key: convert_to_serializable(value) for key, value in obj.items()}
            elif isinstance(obj, list):
                return [convert_to_serializable(item) for item in obj]
            else:
                return obj
        
        serializable_dict = convert_to_serializable(candidates_dict)
        
        with open(cache_file, 'w') as f:
            json.dump(serializable_dict, f, indent=2)
        
        total_candidates = sum(len(v) for v in candidates_dict.values())
        logging.info(f"CACHED: Candidates for {date_str} ({total_candidates} total)")
        
    except Exception as e:
        logging.warning(f"Could not cache candidates for {date_str}: {e}")

def load_cached_candidates(date_str):
    cache_file = os.path.join(cache_dir, f"candidates_{date_str}.json")
    
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r') as f:
                candidates = json.load(f)
            
            for strategy, candidate_list in candidates.items():
                for candidate in candidate_list:
                    if 'date' in candidate and isinstance(candidate['date'], str):
                        try:
                            candidate['date'] = pd.to_datetime(candidate['date'])
                        except:
                            pass
            
            total_candidates = sum(len(v) for v in candidates.values())
            logging.info(f"CACHE HIT: Loaded candidates for {date_str} ({total_candidates} total)")
            return candidates
            
        except Exception as e:
            logging.warning(f"Error loading cached candidates for {date_str}: {e}")
            try:
                os.remove(cache_file)
            except:
                pass
    
    return None

def fetch_candidates_for_date(date: datetime, api_key: str) -> Dict[str, List[Dict]]:
    
    try:
        date_str = date.strftime('%Y-%m-%d')
        cached_candidates = load_cached_candidates(date_str)
        if cached_candidates is not None:
            return cached_candidates

        logging.info(f"CACHE MISS: Fetching candidates for {date_str} from API")
        
        eastern = pytz.timezone('US/Eastern')
        if date.tzinfo is None:
            date = eastern.localize(date)
            
        previous_day = get_previous_trading_day(date)
        if previous_day is None:
            empty_result = {'gap': [], 'backside': []}
            cache_daily_candidates(date_str, empty_result)
            return empty_result
            
        prev_date_str = previous_day.strftime('%Y-%m-%d')
        
        # Get previous day's closing prices
        prev_close_url = f"{POLYGON_BASE_URL}/aggs/grouped/locale/us/market/stocks/{prev_date_str}?adjusted=false&type=CS,PS,ADR&apiKey={api_key}"
        prev_close_response = requests.get(prev_close_url)
        prev_close_response.raise_for_status()
        prev_close_data = prev_close_response.json()
        
        prev_closes = {stock['T']: stock['c'] for stock in prev_close_data.get('results', [])}
        initial_candidates = []
        
        # Get current date data
        current_url = f"{POLYGON_BASE_URL}/aggs/grouped/locale/us/market/stocks/{date_str}?adjusted=false&type=CS,PS,ADR&apiKey={api_key}"
        current_response = requests.get(current_url)
        current_response.raise_for_status()
        current_data = current_response.json()
        
        # First screening using daily data
        if 'results' in current_data:
            for stock in current_data['results']:
                ticker = stock['T']
                opening = stock['o']
                
                if not filter_ticker_symbols(ticker):
                    continue
                    
                if ticker in prev_closes:
                    prev_close = prev_closes[ticker]
                    initial_gap = ((opening - prev_close) / prev_close) * 100
                    
                    needs_split_check = initial_gap >= 500
                    
                    if initial_gap >= 45 and opening >= 0.30:
                        initial_candidates.append({
                            'ticker': ticker,
                            'previous_close': prev_close,
                            'initial_gap': initial_gap,
                            'needs_split_check': needs_split_check
                        })
        
        # Process intraday data for all initial candidates
        final_candidates = []
        for candidate in initial_candidates:
            ticker = candidate['ticker']
            
            intraday_data = fetch_intraday_data(ticker, date_str)
            if intraday_data is not None:
                df = pd.DataFrame(intraday_data)
                if not df.empty:
                    df['t'] = pd.to_datetime(df['t'], unit='ms')
                    if df['t'].dt.tz is None:
                        df['t'] = df['t'].dt.tz_localize('UTC').dt.tz_convert(eastern)
                    elif df['t'].dt.tz != eastern:
                        df['t'] = df['t'].dt.tz_convert(eastern)
                    
                    # Get 9:28 candle with fallback
                    candle_928 = df[df['t'].dt.time == time(9, 28)]
                    
                    if candle_928.empty:
                        candle_929 = df[df['t'].dt.time == time(9, 29)]
                        if not candle_929.empty:
                            candle_928 = candle_929
                        else:
                            candle_927 = df[df['t'].dt.time == time(9, 27)]
                            if not candle_927.empty:
                                candle_928 = candle_927
                    
                    if not candle_928.empty:
                        price_928 = candle_928.iloc[0]['c']
                        gap_928 = ((price_928 - candidate['previous_close']) / candidate['previous_close']) * 100
                        
                        # Check for split if suspicious gap
                        if candidate['needs_split_check'] or gap_928 > 500:
                            is_split = False
                            try:
                                cache_file = os.path.join(cache_dir, f"{ticker}_{date_str}_is_split.txt")
                                if os.path.exists(cache_file):
                                    with open(cache_file, 'r') as f:
                                        is_split = f.read().strip() == 'True'
                                else:
                                    url = f"https://api.polygon.io/v3/reference/splits?ticker={ticker}&execution_date.gte={prev_date_str}&execution_date.lte={date_str}&apiKey={api_key}"
                                    response = requests.get(url)
                                    if response.status_code == 200:
                                        data = response.json()
                                        is_split = 'results' in data and len(data['results']) > 0
                                        
                                        with open(cache_file, 'w') as f:
                                            f.write(str(is_split))
                            except Exception:
                                pass
                            
                            if is_split:
                                continue
                        
                        # Check criteria
                        if gap_928 >= 50 and price_928 >= 0.30:
                            pre_market_data = df[df['t'].dt.time < time(9, 30)]
                            pre_market_volume = pre_market_data['v'].sum() if not pre_market_data.empty else 0
                            
                            if pre_market_volume >= 1000000:
                                final_candidates.append({
                                    'ticker': ticker,
                                    'gap_percentage': gap_928,
                                    'volume': pre_market_volume,
                                    'price': price_928,
                                    'previous_close': candidate['previous_close'],
                                    'float_size': 3000000,
                                    'gap_928': gap_928,
                                    'price_928': price_928,
                                    'date': date_str
                                })

        final_result = {
            'gap': final_candidates,
            'backside': final_candidates,
            'intraday_backside': []
        }
        
        cache_daily_candidates(date_str, final_result)
        
        return final_result
        
    except Exception as e:
        logging.error(f"Error fetching candidates: {str(e)}")
        logging.error(traceback.format_exc())
        empty_result = {'gap': [], 'backside': [], 'intraday_backside': []}
        try:
            cache_daily_candidates(date_str, empty_result)
        except:
            pass
        return empty_result

def fetch_candidates_for_date_range(start_date: datetime, end_date: datetime, api_key: str) -> List[Dict]:
    
    all_candidates = []
    date_range = pd.date_range(start=start_date, end=end_date, freq='B')
    
    cache_hits = 0
    cache_misses = 0
    total_candidates_found = 0
    start_time = datetime.now()
    
    session = requests.Session()
    retries = Retry(total=3, backoff_factor=0.1, status_forcelist=[429, 500, 502, 503, 504])
    session.mount('https://', HTTPAdapter(max_retries=retries, pool_connections=20, pool_maxsize=20))
    
    api_calls = 0
    minute_start = datetime.now()
    REQUESTS_PER_MINUTE = 20
    MIN_REQUEST_INTERVAL = 1.0 / (REQUESTS_PER_MINUTE / 60)
    last_request_time = datetime.now()
    
    logging.info(f"Starting candidate fetching for {len(date_range)} dates")
    
    for current_date in tqdm(date_range, desc="Fetching data for dates"):
        try:
            date_str = current_date.strftime('%Y-%m-%d')
            
            cache_file = os.path.join(cache_dir, f"candidates_{date_str}.json")
            is_cache_hit = os.path.exists(cache_file)
            
            if is_cache_hit:
                cache_hits += 1
            else:
                cache_misses += 1
                
                time_since_last_request = (datetime.now() - last_request_time).total_seconds()
                if time_since_last_request < MIN_REQUEST_INTERVAL:
                    sleep_time = MIN_REQUEST_INTERVAL - time_since_last_request
                    if sleep_time > 0:
                        sleep(sleep_time)
                
                if (datetime.now() - minute_start).total_seconds() >= 60:
                    api_calls = 0
                    minute_start = datetime.now()
            
            daily_candidates = fetch_candidates_for_date(current_date, api_key)
            
            if daily_candidates and (daily_candidates['gap'] or daily_candidates['backside']):
                for candidate in daily_candidates['gap']:
                    candidate['strategy'] = 'gap'
                    candidate['date'] = current_date
                    all_candidates.append(candidate)
                    total_candidates_found += 1
                    
                    backside_candidate = candidate.copy()
                    backside_candidate['strategy'] = 'backside'
                    all_candidates.append(backside_candidate)
                
                if not is_cache_hit:
                    api_calls += 1
                    last_request_time = datetime.now()
            
            if not is_cache_hit and api_calls > 0:
                time_elapsed = (datetime.now() - minute_start).total_seconds()
                if time_elapsed < 60:
                    remaining_calls = REQUESTS_PER_MINUTE - api_calls
                    if remaining_calls > 0:
                        sleep_time = max(0, MIN_REQUEST_INTERVAL - (datetime.now() - last_request_time).total_seconds())
                        if sleep_time > 0:
                            sleep(sleep_time)
            
        except Exception as e:
            logging.error(f"Error fetching candidates for {current_date}: {str(e)}")
            logging.error(traceback.format_exc())
            continue

    end_time = datetime.now()
    total_time = (end_time - start_time).total_seconds()
    
    logging.info(f"\nCandidate fetching complete!")
    logging.info(f"Total time: {total_time:.1f} seconds ({total_time/60:.1f} minutes)")
    logging.info(f"Cache hits: {cache_hits}")
    logging.info(f"Cache misses: {cache_misses}")
    logging.info(f"Cache hit rate: {cache_hits/(cache_hits+cache_misses)*100:.1f}%")
    logging.info(f"Total candidates found: {total_candidates_found}")
    
    return all_candidates

def find_intraday_backside_candidates(date: datetime, api_key: str) -> List[Dict]:
    
    try:
        import json
        date_str = date.strftime('%Y-%m-%d')
        
        weekday = date.weekday()
        is_monday = (weekday == 0)
        if is_monday:
            logging.info(f"Today is Monday, intraday backside trades are typically skipped on Mondays")
        
        cache_file = os.path.join(cache_dir, f"intraday_backside_candidates_{date_str}.json")
        
        if os.path.exists(cache_file):
            logging.info(f"CACHE HIT: Loading intraday backside candidates for {date_str} from cache")
            with open(cache_file, 'r') as f:
                candidates = json.load(f)
                return candidates
        
        logging.info(f"CACHE MISS: Finding intraday backside candidates for {date_str}")
        
        url = f"{POLYGON_BASE_URL}/aggs/grouped/locale/us/market/stocks/{date_str}?adjusted=false&apiKey={api_key}"
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        
        candidates = []
        pending_candidates = []
        filtered_tickers_count = 0
        
        if 'results' in data:
            total_stocks = len(data['results'])
            logging.info(f"Scanning {total_stocks} stocks for intraday backside moves")
            
            for stock in data['results']:
                try:
                    ticker = stock['T']
                    
                    ticker_filter_result = filter_ticker_symbols(ticker)
                    if not ticker_filter_result:
                        filtered_tickers_count += 1
                        continue
                        
                    high_price = stock.get('h', 0)
                    volume = stock.get('v', 0)
                    open_price = stock.get('o', 0)
                    
                    if open_price <= 0 or high_price <= 0:
                        continue
                        
                    move_from_open = ((high_price - open_price) / open_price) * 100
                    
                    price_range_check = INTRADAY_BACKSIDE_PARAMS['PREVIOUS_CLOSE_MIN'] <= open_price <= INTRADAY_BACKSIDE_PARAMS['PREVIOUS_CLOSE_MAX']
                    volume_check = volume >= INTRADAY_BACKSIDE_PARAMS['MIN_VOLUME']
                    move_check = move_from_open >= INTRADAY_BACKSIDE_PARAMS['MIN_PRICE_MOVE_PERCENT']
                    
                    if price_range_check and (move_check or volume_check):
                        pending_candidates.append({
                            'ticker': ticker,
                            'move_percent': move_from_open,
                            'volume': volume,
                            'open': open_price,
                            'high': high_price
                        })
                        
                except Exception as e:
                    logging.warning(f"Error processing stock {stock.get('T', 'Unknown')}: {str(e)}")
                    continue
            
            eastern = pytz.timezone('US/Eastern')
            for potential in pending_candidates:
                ticker = potential['ticker']
                
                if (potential['volume'] >= INTRADAY_BACKSIDE_PARAMS['MIN_VOLUME'] and 
                    potential['move_percent'] >= INTRADAY_BACKSIDE_PARAMS['MIN_PRICE_MOVE_PERCENT']):
                    
                    intraday_data = fetch_intraday_data(ticker, date_str)
                    if intraday_data:
                        df = pd.DataFrame(intraday_data)
                        if not df.empty:
                            if pd.api.types.is_numeric_dtype(df['t']):
                                df['t'] = pd.to_datetime(df['t'], unit='ms', utc=True).dt.tz_convert(eastern)
                            else:
                                df['t'] = pd.to_datetime(df['t'], utc=True).dt.tz_convert(eastern)
                            
                            market_hours = df[df['t'].dt.time >= time(9, 30)].reset_index(drop=True)
                            if not market_hours.empty:
                                market_hours['cum_vol'] = market_hours['v'].cumsum()
                                day_open = market_hours.iloc[0]['o']
                                market_hours['pct_move'] = ((market_hours['h'] - day_open) / day_open) * 100
                                
                                conditions_met = market_hours[
                                    (market_hours['cum_vol'] >= INTRADAY_BACKSIDE_PARAMS['MIN_VOLUME']) & 
                                    (market_hours['pct_move'] >= INTRADAY_BACKSIDE_PARAMS['MIN_PRICE_MOVE_PERCENT'])
                                ]
                                
                                if not conditions_met.empty:
                                    candidate = {
                                        'ticker': ticker,
                                        'move_percent': potential['move_percent'],
                                        'volume': potential['volume'],
                                        'open': potential['open'],
                                        'high': potential['high'],
                                        'date': date_str,
                                        'float_size': 3000000
                                    }
                                    candidates.append(candidate)
                                    first_match = conditions_met.iloc[0]
                                    logging.info(f"Found intraday candidate: {ticker} - Move: {potential['move_percent']:.2f}%, Vol: {potential['volume']:,}")
            
            if filtered_tickers_count > 0:
                logging.debug(f"Filtered out {filtered_tickers_count} tickers due to suffix or length restrictions")
                
            logging.info(f"Found {len(candidates)} intraday backside candidates")
            
            candidates.sort(key=lambda x: -x['move_percent'])
            
            try:
                with open(cache_file, 'w') as f:
                    json.dump(candidates, f)
                logging.info(f"Successfully cached {len(candidates)} candidates to {cache_file}")
            except Exception as e:
                logging.error(f"Error caching candidates: {str(e)}")
        
        return candidates
        
    except Exception as e:
        logging.error(f"Error finding intraday candidates: {str(e)}")
        logging.error(traceback.format_exc())
        return []

def convert_candidates_to_dataframe(candidates_dict: Dict) -> Dict[str, pd.DataFrame]:
    
    gap_data = []
    backside_data = []
    
    if isinstance(candidates_dict, list):
        for candidate in candidates_dict:
            try:
                float_size = float(candidate['float_size']) if candidate['float_size'] is not None else None
            except (ValueError, TypeError):
                float_size = None
                
            data_entry = {
                'Date': pd.to_datetime(candidate['date']),
                'Symbol': candidate['ticker'],
                'GapPercentage': candidate['gap_percentage'],
                'Volume': candidate['volume'],
                'Price': candidate['price'],
                'PreviousClose': candidate['previous_close'],
                'Float': float_size
            }
            if candidate['strategy'] == 'gap':
                gap_data.append(data_entry)
            else:
                backside_data.append(data_entry)
    
    else:
        for candidate in candidates_dict['gap']:
            try:
                float_size = float(candidate['float_size']) if candidate['float_size'] is not None else None
            except (ValueError, TypeError):
                float_size = None
                
            entry = {
                'Date': pd.to_datetime(candidate.get('date', pd.Timestamp.now().date())),
                'Symbol': candidate['ticker'],
                'GapPercentage': candidate['gap_percentage'],
                'Volume': candidate['volume'],
                'Price': candidate['price'],
                'PreviousClose': candidate['previous_close'],
                'Float': float_size
            }
            gap_data.append(entry)
            backside_data.append(entry)
    
    columns = ['Date', 'Symbol', 'GapPercentage', 'Volume', 'Price', 'PreviousClose', 'Float']
    gap_df = pd.DataFrame(gap_data, columns=columns) if gap_data else pd.DataFrame(columns=columns)
    backside_df = pd.DataFrame(backside_data, columns=columns) if backside_data else pd.DataFrame(columns=columns)
    
    for df in [gap_df, backside_df]:
        if not df.empty and 'Date' in df.columns:
            df['Date'] = pd.to_datetime(df['Date'])
    
    return {
        'gap': gap_df,
        'backside': backside_df
    }

# ============================================================================
# TRADING LOGIC HELPER FUNCTIONS
# ============================================================================

def calculate_min_overall_move_adj(previous_close: float) -> float:
    aggression_factor = 1
    if previous_close < 0.25:
        return MIN_OVERALL_MOVE_PERCENT + (250 / (pow(aggression_factor, 7))) - 5
    elif previous_close < 0.40:
        return MIN_OVERALL_MOVE_PERCENT + (155 / (pow(aggression_factor, 7))) - 5
    elif previous_close < 0.60:
        return MIN_OVERALL_MOVE_PERCENT + (115 / (pow(aggression_factor, 7))) - 5
    elif previous_close < 0.90:
        return MIN_OVERALL_MOVE_PERCENT + (45 / (pow(aggression_factor, 7))) - 5
    elif previous_close < 1.2:
        return MIN_OVERALL_MOVE_PERCENT + (30 / (pow(aggression_factor, 7))) - 5
    else:
        return MIN_OVERALL_MOVE_PERCENT

def calculate_high_of_day(candles: List[Dict], index: int) -> Tuple[float, float]:
    high_of_day = max(c['h'] for c in candles[:index+1])
    
    market_open_time = time(9, 30)
    current_time = pd.to_datetime(candles[index]['t']).time()
    
    if current_time < market_open_time:
        high_of_day_rth = 0
    else:
        high_of_day_rth = max(c['h'] for c in candles[:index+1] 
                             if pd.to_datetime(c['t']).time() >= market_open_time)
    
    return high_of_day, high_of_day_rth

def is_pre_trigger_one(candles: List[Dict], index: int, previous_close: float, high_of_day: float, min_overall_move_adj: float) -> Tuple[bool, str]:
    candle = candles[index]
    change_from_close = 100 * (candle['h'] - previous_close) / previous_close
    change_30_bars_ago = 100 * (candles[max(0, index-EXTENSION_OCCURS_WITHIN_BARS)]['c'] - previous_close) / previous_close
    
    if candle['h'] != high_of_day:
        return False, "High is not equal to high of day"
    if change_from_close <= min_overall_move_adj:
        return False, f"Change from close ({change_from_close:.2f}) is not greater than min overall move ({min_overall_move_adj:.2f})"
    if (change_from_close - change_30_bars_ago) <= MIN_EXTENSION_PERCENT:
        return False, f"Extension ({change_from_close - change_30_bars_ago:.2f}) is not greater than {MIN_EXTENSION_PERCENT}%"
    
    return True, "Pre-Trigger One conditions met"

def is_pre_trigger_two(candle: Dict, high_of_day: float, previous_close: float) -> Tuple[bool, str]:
    if high_of_day == previous_close:
        return False, "High of day is equal to previous close"
    
    pullback = (100 * (high_of_day - candle['c']) / (high_of_day - previous_close))
    
    if np.isnan(pullback) or np.isinf(pullback):
        return False, f"Invalid pullback calculation"
    
    if pullback <= MIN_PULLBACK_PERCENT:
        return False, f"Pullback ({pullback:.2f}%) is not greater than {MIN_PULLBACK_PERCENT}%"
    
    return True, f"Pre-Trigger Two conditions met with pullback of {pullback:.2f}%"

def is_stuff_window(candles: List[Dict], index: int) -> Tuple[bool, str]:
    if index < 20:
        return False, "Not enough candles for Stuff Window check"
    open_20_bars_ago = candles[index - 20]['o']
    highest_high = max(candle['h'] for candle in candles[index-20:index+1])
    price_condition = 1.00 if candles[index]['c'] >= 8 else 0.20
    if highest_high - open_20_bars_ago <= price_condition:
        return False, f"Highest high ({highest_high:.2f}) not more than ${price_condition:.2f} above open 20 bars ago ({open_20_bars_ago:.2f})"
    if candles[index]['c'] > open_20_bars_ago:
        return False, f"Current close ({candles[index]['c']:.2f}) not below open 20 bars ago ({open_20_bars_ago:.2f})"
    return True, "Stuff Window conditions met"

def is_stuff_window_2(candles: List[Dict], index: int) -> Tuple[bool, str]:
    if index < 5:
        return False, "Not enough candles for Stuff Window 2 check"
    open_5_bars_ago = candles[index - 5]['o']
    highest_high = max(candle['h'] for candle in candles[index-5:index+1])
    price_condition = 1.40 if candles[index]['c'] >= 8 else 0.25
    if highest_high - open_5_bars_ago <= price_condition:
        return False, f"Highest high ({highest_high:.2f}) not more than ${price_condition:.2f} above open 5 bars ago ({open_5_bars_ago:.2f})"
    if candles[index]['c'] > open_5_bars_ago:
        return False, f"Current close ({candles[index]['c']:.2f}) not below open 5 bars ago ({open_5_bars_ago:.2f})"
    return True, "Stuff Window 2 conditions met"

def is_stuff_candle_hard(candle: Dict) -> Tuple[bool, str]:
    price_condition = 0.70 if candle['c'] >= 8 else 0.20
    volume_condition = 600000 if candle['c'] >= 8 else 900000
    if candle['h'] - candle['o'] <= price_condition:
        return False, f"High ({candle['h']:.2f}) not more than ${price_condition:.2f} above open ({candle['o']:.2f})"
    if candle['c'] > candle['o']:
        return False, f"Close ({candle['c']:.2f}) not below open ({candle['o']:.2f})"
    if candle['v'] <= volume_condition:
        return False, f"Volume ({candle['v']}) not greater than {volume_condition}"
    return True, "Stuff Candle Hard conditions met"

def check_stuff_trigger(candles: List[Dict], index: int, pre_trigger_two_count: int, previous_close: float, 
                       stuff_trigger_count: int, high_of_day: float, high_of_day_rth: float) -> Tuple[bool, List[str]]:
    candle = candles[index]
    debug_messages = []

    if stuff_trigger_count >= 4:
        debug_messages.append("STUFF trigger count is already 4 or more")
        return False, debug_messages

    stuff_window, sw_msg = is_stuff_window(candles, index)
    stuff_window_2, sw2_msg = is_stuff_window_2(candles, index)
    stuff_candle_hard, sch_msg = is_stuff_candle_hard(candle)
    debug_messages.extend([sw_msg, sw2_msg, sch_msg])

    stuff_condition = (
        (stuff_window and not is_stuff_window(candles, index-1)[0]) or
        (stuff_window_2 and not is_stuff_window_2(candles, index-1)[0]) or
        stuff_candle_hard
    )

    if not stuff_condition:
        debug_messages.append("No Stuff condition met")
        return False, debug_messages

    pre_trigger_one, pt1_msg = is_pre_trigger_one(candles, index, previous_close, high_of_day, 
                                                 calculate_min_overall_move_adj(previous_close))
    debug_messages.append(pt1_msg)

    if not (pre_trigger_two_count > 0 or pre_trigger_one):
        debug_messages.append("Neither Pre-Trigger Two count > 0 nor Pre-Trigger One met")
        return False, debug_messages

    if candle['c'] >= 11.75:
        debug_messages.append(f"Close ({candle['c']:.2f}) not below $11.75")
        return False, debug_messages

    total_volume = sum(c['v'] for c in candles[:index+1])
    if total_volume <= 1000000:
        debug_messages.append(f"Total volume ({total_volume}) not greater than 1,000,000")
        return False, debug_messages

    debug_messages.append("All STUFF trigger conditions met")
    return True, debug_messages

def check_intraday_stuff_trigger(candles: List[Dict], index: int, pre_trigger_two_count: int, 
                       stuff_trigger_count: int, high_of_day: float) -> Tuple[bool, List[str]]:
    
    candle = candles[index]
    debug_messages = []

    if stuff_trigger_count >= 4:
        debug_messages.append("STUFF trigger count is already 4 or more")
        return False, debug_messages

    stuff_window, sw_msg = check_intraday_stuff_window(candles, index)
    stuff_window_2, sw2_msg = check_intraday_stuff_window_2(candles, index)
    stuff_candle_hard, sch_msg = check_intraday_stuff_candle_hard(candle)
    debug_messages.extend([sw_msg, sw2_msg, sch_msg])

    stuff_condition = (
        (stuff_window and not check_intraday_stuff_window(candles, index-1)[0]) or
        (stuff_window_2 and not check_intraday_stuff_window_2(candles, index-1)[0]) or
        stuff_candle_hard
    )

    if not stuff_condition:
        debug_messages.append("No Stuff condition met")
        return False, debug_messages

    min_overall_move_adj = calculate_min_overall_move_adj(candle['c'])
    pre_trigger_one, pt1_msg = check_intraday_pre_trigger_one(candles, index, high_of_day, min_overall_move_adj)
    debug_messages.append(pt1_msg)

    if not (pre_trigger_two_count > 0 or pre_trigger_one):
        debug_messages.append("Neither Pre-Trigger Two count > 0 nor Pre-Trigger One met")
        return False, debug_messages

    if candle['c'] >= 11.75:
        debug_messages.append(f"Close ({candle['c']:.2f}) not below $11.75")
        return False, debug_messages

    total_volume = sum(c['v'] for c in candles[:index+1])
    if total_volume <= 1000000:
        debug_messages.append(f"Total volume ({total_volume}) not greater than 1,000,000")
        return False, debug_messages

    debug_messages.append("All STUFF trigger conditions met")
    return True, debug_messages

def check_intraday_stuff_window(candles: List[Dict], index: int) -> Tuple[bool, str]:
    if index < 20:
        return False, "Not enough candles for Stuff Window check"
        
    open_20_bars_ago = candles[index - 20]['o']
    highest_high = max(candle['h'] for candle in candles[index-20:index+1])
    price_condition = 1.00 if candles[index]['c'] >= 8 else 0.20
    
    if highest_high - open_20_bars_ago <= price_condition:
        return False, f"Highest high ({highest_high:.2f}) not more than ${price_condition:.2f} above open 20 bars ago ({open_20_bars_ago:.2f})"
    if candles[index]['c'] > open_20_bars_ago:
        return False, f"Current close ({candles[index]['c']:.2f}) not below open 20 bars ago ({open_20_bars_ago:.2f})"
        
    return True, "Stuff Window conditions met"

def check_intraday_stuff_window_2(candles: List[Dict], index: int) -> Tuple[bool, str]:
    if index < 5:
        return False, "Not enough candles for Stuff Window 2 check"
        
    open_5_bars_ago = candles[index - 5]['o']
    highest_high = max(candle['h'] for candle in candles[index-5:index+1])
    price_condition = 1.40 if candles[index]['c'] >= 8 else 0.25
    
    if highest_high - open_5_bars_ago <= price_condition:
        return False, f"Highest high ({highest_high:.2f}) not more than ${price_condition:.2f} above open 5 bars ago ({open_5_bars_ago:.2f})"
    if candles[index]['c'] > open_5_bars_ago:
        return False, f"Current close ({candles[index]['c']:.2f}) not below open 5 bars ago ({open_5_bars_ago:.2f})"
        
    return True, "Stuff Window 2 conditions met"

def check_intraday_stuff_candle_hard(candle: Dict) -> Tuple[bool, str]:
    price_condition = 0.70 if candle['c'] >= 8 else 0.20
    volume_condition = 600000 if candle['c'] >= 8 else 900000
    
    if candle['h'] - candle['o'] <= price_condition:
        return False, f"High ({candle['h']:.2f}) not more than ${price_condition:.2f} above open ({candle['o']:.2f})"
    if candle['c'] > candle['o']:
        return False, f"Close ({candle['c']:.2f}) not below open ({candle['o']:.2f})"
    if candle['v'] <= volume_condition:
        return False, f"Volume ({candle['v']}) not greater than {volume_condition}"
        
    return True, "Stuff Candle Hard conditions met"

def check_intraday_pre_trigger_one(candles: List[Dict], index: int, high_of_day: float, min_overall_move_adj: float) -> Tuple[bool, str]:
    candle = candles[index]
    change_from_open = 100 * (candle['h'] - candles[0]['o']) / candles[0]['o']
    change_30_bars_ago = 100 * (candles[max(0, index-EXTENSION_OCCURS_WITHIN_BARS)]['c'] - candles[0]['o']) / candles[0]['o']
    
    if candle['h'] != high_of_day:
        return False, "High is not equal to high of day"
    if change_from_open <= min_overall_move_adj:
        return False, f"Change from open ({change_from_open:.2f}) is not greater than min overall move ({min_overall_move_adj:.2f})"
    if (change_from_open - change_30_bars_ago) <= MIN_EXTENSION_PERCENT:
        return False, f"Extension ({change_from_open - change_30_bars_ago:.2f}) is not greater than {MIN_EXTENSION_PERCENT}%"
    
    return True, "Pre-Trigger One conditions met"

def check_intraday_pre_trigger_two(candle: Dict, high_of_day: float, open_price: float) -> Tuple[bool, str]:
    if high_of_day == open_price:
        return False, "High of day is equal to open price"
    
    pullback = (100 * (high_of_day - candle['c']) / (high_of_day - open_price))
    
    if np.isnan(pullback) or np.isinf(pullback):
        return False, f"Invalid pullback calculation"
    
    if pullback <= MIN_PULLBACK_PERCENT:
        return False, f"Pullback ({pullback:.2f}%) is not greater than {MIN_PULLBACK_PERCENT}%"
    
    return True, f"Pre-Trigger Two conditions met with pullback of {pullback:.2f}%"

# ============================================================================
# MAIN TRADING STRATEGY FUNCTIONS
# ============================================================================

def simulate_gapper_trade(intraday_df, ticker, date, current_account_size, yesterday_close, pre_market_high, winning_trade_count, float_size):
    
    try:
        if intraday_df is None or len(intraday_df) < 2:
            logging.warning(f"Insufficient data for Gapper {ticker} on {date}")
            return None

        if isinstance(date, str):
            date = pd.to_datetime(date)
            
        logging.info(f"\nAnalyzing Gapper: {ticker} on {date}")
        logging.info(f"Yesterday's close: ${yesterday_close:.4f}")
        
        TRAILING_ACTIVATION_PCT = 0.9
        TRAILING_DISTANCE_PCT = 0.9
        
        eastern = pytz.timezone('US/Eastern')
        if not pd.api.types.is_datetime64_any_dtype(intraday_df['t']):
            intraday_df['t'] = pd.to_datetime(intraday_df['t'], unit='ms')
        if intraday_df['t'].dt.tz is None:
            intraday_df['t'] = intraday_df['t'].dt.tz_localize('UTC').dt.tz_convert(eastern)

        pre_market_data = intraday_df[intraday_df['t'].dt.time < time(9, 30)]
        if not pre_market_data.empty:
            calculated_pmh = pre_market_data['h'].max()
            pmh_time = pre_market_data[pre_market_data['h'] == calculated_pmh]['t'].iloc[0]
            logging.info(f"Calculated PMH: ${calculated_pmh:.4f} at {pmh_time.strftime('%H:%M:%S')}")
            
            if abs(calculated_pmh - pre_market_high) > 0.01:
                logging.warning(f"PMH MISMATCH - Using calculated PMH: ${calculated_pmh:.4f}")
                pre_market_high = calculated_pmh

        # Get 9:28 candle for stock selection validation
        candle_928 = intraday_df[intraday_df['t'].dt.time == time(9, 28)]
        if candle_928.empty:
            logging.warning(f"9:28 candle not found for {ticker}")
            return None
            
        price_928 = candle_928.iloc[0]['c']
        gap_percentage = ((price_928 - yesterday_close) / yesterday_close) * 100
        logging.info(f"9:28 close price: ${price_928:.4f} (used for stock selection)")
        logging.info(f"Gap percentage (9:28): {gap_percentage:.2f}%")

        # Get 9:29 candle for entry and stop calculations
        candle_929 = intraday_df[intraday_df['t'].dt.time == time(9, 29)]
        if candle_929.empty:
            logging.warning(f"9:29 candle not found for {ticker}")
            return None
            
        price_929 = candle_929.iloc[0]['c']
        original_entry_price = price_929
        logging.info(f"9:29 close price: ${price_929:.4f} (used for entry and stop calculation)")
        
        pmh_to_entry_drop = (pre_market_high - price_929) / pre_market_high * 100

        entry_time = date.replace(hour=9, minute=30, second=0, microsecond=0)
        exit_time = date.replace(hour=15, minute=0, second=0, microsecond=0)
        entry_time = eastern.localize(entry_time)
        exit_time = eastern.localize(exit_time)

        # Use 9:29 price for stop loss calculations
        stop_loss1 = pre_market_high * 1.2711
        stop_loss1_calc = f"PMH ${pre_market_high:.4f} * 1.2711 = ${stop_loss1:.4f}"
        logging.info(f"Stop Loss 1 calculation: {stop_loss1_calc}")
        
        reference_price = original_entry_price  # This is now 9:29 price
        stop_loss2 = reference_price + (reference_price - yesterday_close) * 0.64
        logging.info(f"Stop Loss 2 calculation: ${reference_price:.4f} + (${reference_price:.4f} - ${yesterday_close:.4f}) * 0.64 = ${stop_loss2:.4f}")

        # Use 9:29 price for position sizing
        shares1 = calculate_position_size(
            current_account_size,
            original_entry_price,
            (stop_loss1 - original_entry_price) / original_entry_price,
            'Gapper1'
        )
        shares2 = calculate_position_size(
            current_account_size,
            original_entry_price,
            (stop_loss2 - original_entry_price) / original_entry_price,
            'Gapper2'
        )
        
        entry_price = apply_slippage(original_entry_price, is_entry=True, is_short=True)
        if entry_price != original_entry_price:
            logging.info(f"Entry slippage applied: Original ${original_entry_price:.4f} -> New ${entry_price:.4f}")
        
        logging.info(f"Entry price: ${entry_price:.4f}")

        market_hours_df = intraday_df[(intraday_df['t'] >= entry_time) & (intraday_df['t'] <= exit_time)]

        if market_hours_df.empty or len(market_hours_df) < 2:
            logging.warning(f"Insufficient market hours data for {ticker}")
            return None

        result1 = result2 = 'End of Day'
        forecasted_exit_price1 = forecasted_exit_price2 = None
        actual_exit_price1 = actual_exit_price2 = None
        exit_time1 = exit_time2 = exit_time
        trailing_stop_activated = False
        trailing_stop_price = float('inf')
        backside_eligible = False
        
        halt_detected = False
        last_candle_time = None
        halt_start_time = None

        for i in range(len(market_hours_df)):
            row = market_hours_df.iloc[i]
            next_row = market_hours_df.iloc[i+1] if i+1 < len(market_hours_df) else None
            
            current_time = row['t']
            
            if last_candle_time is not None:
                time_diff_seconds = (current_time - last_candle_time).total_seconds()
                if time_diff_seconds > 180:
                    if not halt_detected:
                        halt_detected = True
                        halt_start_time = last_candle_time
                        logging.warning(f"HALT DETECTED for {ticker}: {time_diff_seconds/60:.1f} min gap ending at {current_time.strftime('%H:%M:%S')}")
            
            if halt_detected:
                if result1 == 'End of Day' and row['o'] >= stop_loss1:
                    halt_slippage_multiplier = 1.5
                    original_exit_price = row['o']
                    base_exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    additional_halt_slippage = (base_exit_price - original_exit_price) * halt_slippage_multiplier
                    actual_exit_price1 = base_exit_price + additional_halt_slippage
                    
                    exit_time1 = current_time
                    result1 = 'Halt Gap Stop Loss 1'
                    backside_eligible = True
                    logging.warning(f"Position 1 HALT GAP STOP at {current_time.strftime('%H:%M:%S')} - Fill: ${actual_exit_price1:.4f}")
                
                if result2 == 'End of Day' and row['o'] >= stop_loss2 and pmh_to_entry_drop <= max_pmh_to_open_drop:
                    halt_slippage_multiplier = 1.5
                    original_exit_price = row['o']
                    base_exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    additional_halt_slippage = (base_exit_price - original_exit_price) * halt_slippage_multiplier
                    actual_exit_price2 = base_exit_price + additional_halt_slippage
                    
                    exit_time2 = current_time
                    result2 = 'Halt Gap Stop Loss 2'
                    backside_eligible = True
                    logging.warning(f"Position 2 HALT GAP STOP at {current_time.strftime('%H:%M:%S')} - Fill: ${actual_exit_price2:.4f}")
                
                halt_detected = False

            if not halt_detected and not trailing_stop_activated:
                price_drop_pct = (entry_price - row['l']) / entry_price
                if price_drop_pct >= TRAILING_ACTIVATION_PCT:
                    trailing_stop_activated = True
                    trailing_stop_price = row['l'] * (1 + TRAILING_DISTANCE_PCT)
                    logging.info(f"Trailing stop activated - Initial trailing stop set at ${trailing_stop_price:.4f}")

            if not halt_detected and trailing_stop_activated:
                if row['l'] < trailing_stop_price / (1 + TRAILING_DISTANCE_PCT):
                    trailing_stop_price = row['l'] * (1 + TRAILING_DISTANCE_PCT)
                    logging.info(f"Trailing stop updated to: ${trailing_stop_price:.4f}")

            if not halt_detected and trailing_stop_activated:
                if row['h'] >= trailing_stop_price:
                    exit_price = row['o'] if row['o'] > trailing_stop_price else trailing_stop_price
                    if result1 == 'End of Day':
                        actual_exit_price1 = apply_slippage(exit_price, is_entry=False, is_short=True)
                        exit_time1 = row['t']
                        result1 = 'Trailing Stop'
                    if result2 == 'End of Day' and pmh_to_entry_drop <= max_pmh_to_open_drop:
                        actual_exit_price2 = apply_slippage(exit_price, is_entry=False, is_short=True)
                        exit_time2 = row['t']
                        result2 = 'Trailing Stop'
                    logging.info(f"Positions stopped out by trailing stop at {row['t'].strftime('%H:%M:%S')}")
                    break

            elif not halt_detected:
                if result1 == 'End of Day' and row['h'] >= stop_loss1:
                    original_exit_price = row['o'] if row['o'] > stop_loss1 else stop_loss1
                    actual_exit_price1 = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    exit_time1 = row['t']
                    result1 = 'Stop Loss 1'
                    backside_eligible = True
                    logging.info(f"Position 1 stopped out at {row['t'].strftime('%H:%M:%S')}")

                if result2 == 'End of Day' and row['h'] >= stop_loss2 and pmh_to_entry_drop <= max_pmh_to_open_drop:
                    original_exit_price = row['o'] if row['o'] > stop_loss2 else stop_loss2
                    actual_exit_price2 = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    exit_time2 = row['t']
                    result2 = 'Stop Loss 2'
                    backside_eligible = True
                    logging.info(f"Position 2 stopped out at {row['t'].strftime('%H:%M:%S')}")

            last_candle_time = current_time

            if result1 != 'End of Day' and (result2 != 'End of Day' or pmh_to_entry_drop > max_pmh_to_open_drop):
                break

        # Handle EOD exit for any remaining open positions
        if actual_exit_price1 is None or actual_exit_price2 is None:
            closing_candle = market_hours_df[market_hours_df['t'].dt.time == time(15, 0)]
            if not closing_candle.empty:
                if actual_exit_price1 is None:
                    original_close_price = closing_candle.iloc[0]['o']
                    actual_exit_price1 = apply_slippage(original_close_price, is_entry=False, is_short=True)
                    forecasted_exit_price1 = original_close_price
                if actual_exit_price2 is None and pmh_to_entry_drop <= max_pmh_to_open_drop:
                    original_close_price = closing_candle.iloc[0]['o']
                    actual_exit_price2 = apply_slippage(original_close_price, is_entry=False, is_short=True)
                    forecasted_exit_price2 = original_close_price
            else:
                last_candle = market_hours_df.iloc[-1]
                if actual_exit_price1 is None:
                    original_close_price = last_candle['o']
                    actual_exit_price1 = apply_slippage(original_close_price, is_entry=False, is_short=True)
                    forecasted_exit_price1 = original_close_price
                if actual_exit_price2 is None and pmh_to_entry_drop <= max_pmh_to_open_drop:
                    original_close_price = last_candle['o']
                    actual_exit_price2 = apply_slippage(original_close_price, is_entry=False, is_short=True)
                    forecasted_exit_price2 = original_close_price

        # Calculate P&L
        if actual_exit_price1 is not None:
            profit_loss1 = (entry_price - actual_exit_price1) * shares1
            commission1 = (entry_price + actual_exit_price1) * shares1 * (commission_percentage / 100)
        else:
            logging.error(f"Missing exit price 1 for {ticker}")
            return None

        if pmh_to_entry_drop <= max_pmh_to_open_drop and actual_exit_price2 is not None:
            profit_loss2 = (entry_price - actual_exit_price2) * shares2
            commission2 = (entry_price + actual_exit_price2) * shares2 * (commission_percentage / 100)
        else:
            profit_loss2 = 0
            commission2 = 0
        
        net_profit_loss1 = profit_loss1 - commission1
        net_profit_loss2 = profit_loss2 - commission2
        total_net_profit_loss = net_profit_loss1 + net_profit_loss2
        total_commission = commission1 + commission2

        logging.info(f"\nTrade Results:")
        logging.info(f"Total P&L: ${total_net_profit_loss:.2f}")
        logging.info(f"Result 1: {result1}")
        logging.info(f"Result 2: {result2}")

        return {
            'ticker': ticker,
            'date': date.date(),
            'entry_time': entry_time,
            'exit_time1': exit_time1,
            'exit_time2': exit_time2,
            'entry_price': entry_price,
            'forecasted_exit_price1': forecasted_exit_price1,
            'actual_exit_price1': actual_exit_price1,
            'forecasted_exit_price2': forecasted_exit_price2,
            'actual_exit_price2': actual_exit_price2,
            'shares1': shares1,
            'shares2': shares2,
            'result1': result1,
            'result2': result2,
            'profit_loss': total_net_profit_loss,
            'commission': total_commission,
            'pmh_to_entry_drop': pmh_to_entry_drop,
            'strategy': 'Gapper',
            'stop_loss1': stop_loss1,
            'stop_loss2': stop_loss2,
            'open_928': price_928,  # 9:28 price for reference
            'open_929': price_929,  # 9:29 price (actual entry reference)
            'reference_price': reference_price,  # Now 9:29 price
            'float_size': float_size,
            'pre_market_high': pre_market_high,
            'stop_loss1_calculation': stop_loss1_calc,
            'yesterday_close': yesterday_close,
            'gap_percentage': gap_percentage,  # Based on 9:28
            'qualifying_price': price_928,  # 9:28 for stock selection
            'entry_reference_price': price_929,  # 9:29 for entry/stops
            'trailing_stop_activated': trailing_stop_activated,
            'trailing_stop_price': trailing_stop_price if trailing_stop_activated else None,
            'balance_after_trade': current_account_size + total_net_profit_loss,
            'backside_eligible': backside_eligible,
            'halt_detected': halt_start_time is not None,
            'halt_start_time': halt_start_time
        }

    except Exception as e:
        logging.error(f"Error in simulate_gapper_trade for {ticker} on {date}: {str(e)}")
        logging.error(traceback.format_exc())
        return None

def simulate_backside_trade_mac(intraday_df, ticker, date, current_account_size, winning_trade_count, float_size, daily_starting_balance):
    
    try:
        if intraday_df is None or len(intraday_df) < 2:
            logging.warning(f"Insufficient data for Backside {ticker} on {date}")
            return None

        trades = []
        position = 0
        entry_price = 0.0
        original_entry_price = 0.0
        shares = 0
        pre_trigger_two_count = 0
        stuff_trigger_count = 0
        debug_log = []
        high_of_day = float('-inf')
        high_of_day_rth = float('-inf')
        pre_market_high = float('-inf')
        exceeded_pre_market_high = False
        violated_pre_market_high_filter = False
        normalized_stop_triggered = False
        normalized_stop_price = 0.0
        trade = None
        
        # NEW: Variables for trigger detection and delayed entry
        trigger_detected = False
        trigger_candle_index = -1
        
        halt_detected = False
        last_candle_time = None
        halt_start_time = None

        if not pd.api.types.is_datetime64_any_dtype(intraday_df['t']):
            intraday_df['t'] = pd.to_datetime(intraday_df['t'], unit='ms', utc=True).dt.tz_convert('US/Eastern')

        pre_market_data = intraday_df[intraday_df['t'].dt.time < time(9, 30)]
        if not pre_market_data.empty:
            pre_market_high = pre_market_data['h'].max()
            logging.info(f"Pre-market high for {ticker} on {date}: ${pre_market_high:.2f}")
        else:
            logging.warning(f"No pre-market data found for {ticker} on {date}")
            return None

        previous_close = intraday_df.iloc[0]['c']

        # Calculate normalized stop levels (same as before)
        market_hours_data = intraday_df[intraday_df['t'].dt.time >= time(9, 30)]
        if not market_hours_data.empty:
            gapper_entry_price = market_hours_data.iloc[0]['o']
            gapper_stop_1 = pre_market_high * 1.2711
            gapper_stop_2 = gapper_entry_price + (gapper_entry_price - previous_close) * 0.64
            normalized_stop_price = max(gapper_stop_1, gapper_stop_2)
            
            logging.info(f"Simulated gapper entry price (day open): ${gapper_entry_price:.2f}")
            logging.info(f"Gapper Stop 1 (PMH * 1.2711): ${gapper_stop_1:.2f}")
            logging.info(f"Gapper Stop 2 (normalized): ${gapper_entry_price:.2f} + (${gapper_entry_price:.2f} - ${previous_close:.2f}) * 0.64 = ${gapper_stop_2:.2f}")
            logging.info(f"Normalized stop level (higher of the two): ${normalized_stop_price:.2f}")
        else:
            normalized_stop_price = pre_market_high * 1.35
            logging.warning(f"No market hours data found - using fallback normalized stop: ${normalized_stop_price:.2f}")

        intraday_data = intraday_df.to_dict('records')

        logging.info(f"\nProcessing Backside trade for {ticker} on {date}")
        logging.info(f"Previous close: ${previous_close:.2f}")
        logging.info(f"Pre-market high: ${pre_market_high:.2f}")
        logging.info(f"PMH + 27.1% violation level: ${pre_market_high * 1.271:.2f}")
        logging.info(f"Normalized stop level: ${normalized_stop_price:.2f}")

        for i, candle in enumerate(intraday_data):
            candle_time = candle['t']
            candle_hhmm = candle_time.hour * 100 + candle_time.minute

            if candle_time.time() < time(9, 30) or candle_time.time() >= time(16, 0):
                debug_log.append(f"Skipping candle at {candle_time}: outside of trading hours")
                continue

            # Halt detection logic (same as before)
            if last_candle_time is not None:
                time_diff_seconds = (candle_time - last_candle_time).total_seconds()
                if time_diff_seconds > 180:
                    if not halt_detected:
                        halt_detected = True
                        halt_start_time = last_candle_time
                        if position != 0:
                            logging.warning(f"HALT DETECTED for {ticker}: {time_diff_seconds/60:.1f} min gap - IN POSITION")

            high_of_day, high_of_day_rth = calculate_high_of_day(intraday_data, i)

            # Check pre-market high conditions (same as before)
            if not exceeded_pre_market_high and high_of_day_rth > pre_market_high:
                exceeded_pre_market_high = True
                logging.info(f"{ticker} exceeded pre-market high at {candle_time}, Price: ${high_of_day_rth:.2f}")

            violation_price = pre_market_high * (1 + PRE_MARKET_HIGH_VIOLATION_PERCENT / 100.0)
            if exceeded_pre_market_high and not violated_pre_market_high_filter and candle['h'] >= violation_price:
                violated_pre_market_high_filter = True
                logging.info(f"{ticker} violated pre-market high filter at {candle_time}: high=${candle['h']:.2f}, violation_threshold=${violation_price:.2f}")

            if not normalized_stop_triggered and high_of_day_rth >= normalized_stop_price:
                normalized_stop_triggered = True
                logging.info(f"{ticker} triggered normalized stop at {candle_time}, Price: ${high_of_day_rth:.2f}")

            if candle_hhmm > TIME_OF_DAY_MAX:
                if position == 0 and not trigger_detected:
                    debug_log.append(f"Skipping candle at {candle_time}: past TIME_OF_DAY_MAX and no trigger detected")
                    continue

            # MODIFIED: Check for trigger but don't enter immediately
            if position == 0 and not trigger_detected and exceeded_pre_market_high and violated_pre_market_high_filter and normalized_stop_triggered:
                logging.info(f"{ticker} @ {candle_time}: All stop conditions met - "
                           f"PMH_exceeded={exceeded_pre_market_high}, "
                           f"PMH_violated=${violation_price:.2f}, "
                           f"Normalized_triggered=${normalized_stop_price:.2f}")
                
                stuff_trigger, trigger_debug = check_stuff_trigger(
                    intraday_data[: i + 1],
                    i,
                    pre_trigger_two_count,
                    previous_close,
                    stuff_trigger_count,
                    high_of_day,
                    high_of_day_rth
                )
                debug_log.extend(trigger_debug)
                
                if stuff_trigger:
                    if candle_hhmm <= TIME_OF_DAY_MAX:
                        trigger_price = candle['c']
                        
                        # Filter: Skip trades if trigger price is between $1-2
                        if 1.0 <= trigger_price < 2.0:
                            debug_log.append(f"Stuff trigger met but trigger price ${trigger_price:.2f} in losing $1-2 range - skipping")
                            logging.info(f"Skipping Backside trade for {ticker}: trigger price ${trigger_price:.2f} in $1-2 losing range")
                            continue
                        
                        # MODIFIED: Mark trigger detected but don't enter yet
                        trigger_detected = True
                        trigger_candle_index = i
                        stuff_trigger_count += 1
                        
                        logging.info(f"TRIGGER DETECTED for {ticker} at {candle_time}, Price: ${trigger_price:.2f}")
                        logging.info(f"Will enter on NEXT candle open (if available)")
                        debug_log.append(f"Trigger detected at {candle_time}: trigger_price={trigger_price}, will enter next candle")
                    else:
                        debug_log.append("Stuff trigger met but candle is past TIME_OF_DAY_MAX; trade not taken")
            
            # MODIFIED: Enter position on the candle AFTER trigger detection
            elif position == 0 and trigger_detected and i == trigger_candle_index + 1:
                # This is the candle immediately after the trigger candle
                
                # Check if we're still within time limits
                if candle_hhmm <= TIME_OF_DAY_MAX:
                    original_entry_price = candle['o']  # Use OPEN of next candle
                    entry_price = apply_slippage(original_entry_price, is_entry=True, is_short=True)
                    
                    if USE_STATIC_POSITION_SIZING:
                        risk_amount = STATIC_RISK_AMOUNT_BACKSIDE
                    else:
                        risk_amount = daily_starting_balance * BACKSIDE_RISK_PERCENTAGE
                        
                    stop_loss = entry_price * (1 + BACKSIDE_STOP_LOSS_PERCENT)
                    risk_per_share = stop_loss - entry_price
                    
                    if risk_per_share <= 0:
                        debug_log.append("Risk per share non-positive, skipping trade")
                        trigger_detected = False  # Reset trigger
                        continue
                    
                    shares = int(risk_amount / risk_per_share)
                    position = -shares
                    commission = calculate_commission(abs(position) * entry_price)
                    current_account_size -= commission
                    entry_time = candle_time
                    
                    trade = {
                        'ticker': ticker,
                        'date': date,
                        'entry_time': entry_time,
                        'entry_price': entry_price,
                        'original_entry_price': original_entry_price,
                        'shares': shares,
                        'commission': commission,
                        'strategy': 'Backside',
                        'float_size': float_size,
                        'pre_market_high': pre_market_high,
                        'violation_price': violation_price,
                        'normalized_stop_price': normalized_stop_price,
                        'stop_loss': stop_loss,
                        'stop_loss_recorded': False,
                        'daily_starting_balance': daily_starting_balance,
                        'halt_detected': False,
                        'halt_start_time': None,
                        'trigger_candle_index': trigger_candle_index,
                        'entry_candle_index': i
                    }
                    
                    logging.info(f"Entered short position for {ticker} at {entry_time}")
                    logging.info(f"Entry Price: ${entry_price:.2f} (OPEN of candle after trigger)")
                    logging.info(f"Shares: {shares}, Stop Loss: ${stop_loss:.2f}")
                    logging.info(f"Trigger was detected on previous candle, entered on current candle open")
                    debug_log.append(f"Trade entered at {entry_time}: entry_price={entry_price} (next candle open), shares={shares}, stop_loss={stop_loss}")
                else:
                    debug_log.append("Next candle after trigger is past TIME_OF_DAY_MAX; trade not taken")
                    trigger_detected = False  # Reset trigger
            
            # Exit logic (same as before but with halt handling)
            elif position < 0:
                stop_loss = entry_price * (1 + BACKSIDE_STOP_LOSS_PERCENT)

                if halt_detected and (candle['o'] >= stop_loss or candle['h'] >= stop_loss):
                    halt_slippage_multiplier = 1.5
                    
                    if candle['o'] >= stop_loss:
                        original_exit_price = candle['o']
                    else:
                        original_exit_price = stop_loss
                    
                    base_exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    additional_halt_slippage = (base_exit_price - original_exit_price) * halt_slippage_multiplier
                    exit_price = base_exit_price + additional_halt_slippage
                    
                    exit_time = candle_time
                    pnl = (entry_price - exit_price) * abs(position)
                    commission = calculate_commission(abs(position) * exit_price)
                    total_pnl = pnl - commission
                    current_account_size += total_pnl

                    trade.update({
                        'exit_time': exit_time,
                        'exit_price': exit_price,
                        'profit_loss': total_pnl,
                        'exit_type': 'Halt Gap Stop Loss',
                        'stop_loss': stop_loss,
                        'stop_loss_hit_time': candle_time,
                        'stop_loss_recorded': True,
                        'halt_detected': True,
                        'halt_start_time': halt_start_time
                    })
                    trades.append(trade)

                    logging.warning(f"HALT GAP STOP LOSS triggered for {ticker} at {exit_time}, P&L: ${total_pnl:.2f}")
                    debug_log.append(f"Halt gap stop loss hit at {candle_time}: exit_price={exit_price}, total_pnl={total_pnl}")

                    position = 0
                    trade = None
                    trigger_detected = False  # Reset trigger
                    halt_detected = False
                    continue

                elif not halt_detected and (candle['o'] >= stop_loss or candle['h'] >= stop_loss):
                    original_exit_price = candle['o'] if candle['o'] >= stop_loss else stop_loss
                    exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    exit_time = candle_time
                    pnl = (entry_price - exit_price) * abs(position)
                    commission = calculate_commission(abs(position) * exit_price)
                    total_pnl = pnl - commission
                    current_account_size += total_pnl

                    trade.update({
                        'exit_time': exit_time,
                        'exit_price': exit_price,
                        'profit_loss': total_pnl,
                        'exit_type': 'Stop Loss',
                        'stop_loss': stop_loss,
                        'stop_loss_hit_time': candle_time,
                        'stop_loss_recorded': True
                    })
                    trades.append(trade)

                    logging.info(f"Stop loss triggered for {ticker} at {exit_time}, P&L: ${total_pnl:.2f}")
                    debug_log.append(f"Stop loss hit at {candle_time}: exit_price={exit_price}, total_pnl={total_pnl}")

                    position = 0
                    trade = None
                    trigger_detected = False  # Reset trigger
                    continue

                elif candle_time.time() >= time(15, 59):
                    original_exit_price = candle['o']
                    exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    exit_time = candle_time
                    pnl = (entry_price - exit_price) * abs(position)
                    commission = calculate_commission(abs(position) * exit_price)
                    total_pnl = pnl - commission
                    current_account_size += total_pnl

                    trade.update({
                        'exit_time': exit_time,
                        'exit_price': exit_price,
                        'profit_loss': total_pnl,
                        'exit_type': 'EOD',
                        'stop_loss': stop_loss,
                        'stop_loss_recorded': False
                    })
                    trades.append(trade)

                    logging.info(f"EOD exit for {ticker} at {exit_time}, P&L: ${total_pnl:.2f}")
                    debug_log.append(f"EOD exit at {exit_time}: exit_price={exit_price}, total_pnl={total_pnl}")
                    position = 0
                    trigger_detected = False  # Reset trigger

            # Continue with pre-trigger two logic (same as before)
            pre_trigger_two, pt2_msg = is_pre_trigger_two(candle, high_of_day, previous_close)
            if pre_trigger_two:
                pre_trigger_two_count += 1

            last_candle_time = candle_time
            
            if halt_detected and position == 0:
                halt_detected = False

        # Handle any remaining open position at end of day
        if position != 0:
            closing_candle = intraday_data[-1]
            original_exit_price = closing_candle['c']
            exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
            exit_time = closing_candle['t']

            pnl = (entry_price - exit_price) * abs(position)
            commission = calculate_commission(abs(position) * exit_price)
            total_pnl = pnl - commission
            current_account_size += total_pnl

            trade.update({
                'exit_time': exit_time,
                'exit_price': exit_price,
                'profit_loss': total_pnl,
                'exit_type': 'EOD',
                'stop_loss': entry_price * (1 + BACKSIDE_STOP_LOSS_PERCENT),
                'stop_loss_recorded': False
            })
            trades.append(trade)

            logging.info(f"Final EOD exit for {ticker}, P&L: ${total_pnl:.2f}")
            debug_log.append(f"Final EOD exit at {exit_time}: exit_price={exit_price}, total_pnl={total_pnl}")

        if not trades:
            logging.info(f"No Backside trade found for {ticker} on {date}")
            logging.info(f"Final conditions: PMH_exceeded={exceeded_pre_market_high}, "
                        f"PMH_violated={violated_pre_market_high_filter}, "
                        f"Normalized_triggered={normalized_stop_triggered}, "
                        f"Trigger_detected={trigger_detected}")
            return None
        
        halt_trades = [t for t in trades if t.get('halt_detected', False)]
        if halt_trades:
            logging.warning(f"HALT IMPACT: {ticker} experienced {len(halt_trades)} halt-affected trades during session")
            
        return trades

    except Exception as e:
        logging.error(f"Error in simulate_backside_trade_mac for {ticker} on {date}: {str(e)}")
        logging.error(traceback.format_exc())
        return None
    
def simulate_intraday_backside_trade(intraday_df: pd.DataFrame, ticker: str, date: datetime, current_account_size: float, winning_trade_count: int, float_size: float, daily_starting_balance: float, candidate_details: Dict | None = None) -> List[Dict] | None:
    
    local_current_account_size = current_account_size

    try:
        if intraday_df is None or len(intraday_df) < 2:
            logging.warning(f"Insufficient data provided for Intraday Backside {ticker} on {date.strftime('%Y-%m-%d')}")
            return None

        eastern = pytz.timezone('US/Eastern')
        if 't' not in intraday_df.columns:
             logging.error(f"Timestamp column 't' not found in DataFrame for {ticker}.")
             return None
        try:
            if not pd.api.types.is_datetime64_any_dtype(intraday_df['t']) or \
               intraday_df['t'].dt.tz is None or \
               intraday_df['t'].dt.tz.zone != 'US/Eastern':
                if pd.api.types.is_numeric_dtype(intraday_df['t']):
                    intraday_df['t'] = pd.to_datetime(intraday_df['t'], unit='ms', errors='coerce', utc=True).dt.tz_convert(eastern)
                else:
                    intraday_df['t'] = pd.to_datetime(intraday_df['t'], errors='coerce', utc=True).dt.tz_convert(eastern)
            if intraday_df['t'].isnull().any():
                logging.warning(f"Timestamp conversion resulted in NaT values for {ticker}. Removing invalid rows.")
                intraday_df = intraday_df.dropna(subset=['t'])
                if intraday_df.empty:
                    logging.error(f"No valid timestamp data remaining for {ticker} after cleaning NaT.")
                    return None
        except Exception as e:
            logging.error(f"Failed during timestamp column processing for {ticker}: {e}")
            return None

        trades = []
        position = 0
        entry_price = 0.0
        original_entry_price = 0.0
        shares = 0
        pre_trigger_two_count = 0
        stuff_trigger_count = 0
        move_qualified = False
        pullback_qualified = False
        price_history = []
        high_of_day = float('-inf')
        qualify_time = None
        stop_loss = 0.0
        halt_detected = False
        last_candle_time = None
        trade = None
        
        # NEW: Variables for trigger detection and delayed entry
        trigger_detected = False
        trigger_candle_index = -1

        required_cols = ['t', 'o', 'h', 'l', 'c', 'v']
        if not all(col in intraday_df.columns for col in required_cols):
             missing = [col for col in required_cols if col not in intraday_df.columns]
             logging.error(f"Missing required columns for {ticker}: {missing}. Cannot proceed.")
             return None
        intraday_data = intraday_df[required_cols].to_dict('records')

        day_open, open_price_time_ref = get_accurate_day_open(intraday_data, ticker, date, candidate_details)
        if day_open is None or day_open <= 0:
            logging.error(f"Could not determine valid positive day open for {ticker} on {date.strftime('%Y-%m-%d')}. Skipping.")
            return None
        logging.info(f"Using day open price ${day_open:.4f} for {ticker} calculations.")
        high_of_day = day_open

        market_hours_data_for_loop = []
        for c in intraday_data:
            try:
                 if c['t'] is pd.NaT: continue
                 candle_t_time = pd.to_datetime(c['t']).time()
                 if time(9, 30) <= candle_t_time < time(16, 0):
                     market_hours_data_for_loop.append(c)
            except Exception as filter_e:
                 logging.warning(f"Skipping candle due to error during market hours filtering for {ticker}: {c.get('t')}. Error: {filter_e}")
                 continue
        if not market_hours_data_for_loop:
             logging.warning(f"No valid market hours data (9:30-15:59) found for {ticker} on {date.strftime('%Y-%m-%d')} after filtering.")
             return None
        logging.info(f"Starting intraday simulation for {ticker} with {len(market_hours_data_for_loop)} market hour candles.")

        for i, candle in enumerate(market_hours_data_for_loop):
            try:
                candle_time = pd.to_datetime(candle.get('t'))
                if candle_time is pd.NaT: continue
                candle_hhmm = candle_time.hour * 100 + candle_time.minute
                candle_open_price = float(candle.get('o', 0.0))
                candle_high_price = float(candle.get('h', 0.0))
                candle_low_price = float(candle.get('l', 0.0))
                candle_close_price = float(candle.get('c', 0.0))
                candle_volume = int(candle.get('v', 0))
                if not all(p >= 0 for p in [candle_open_price, candle_high_price, candle_low_price, candle_close_price]):
                     logging.warning(f"Skipping candle at {candle_time.strftime('%H:%M:%S')} for {ticker} due to negative OHLC price.")
                     continue
                if candle_high_price < max(candle_open_price, candle_low_price, candle_close_price) or \
                   candle_low_price > min(candle_open_price, candle_high_price, candle_close_price):
                     logging.warning(f"Skipping candle at {candle_time.strftime('%H:%M:%S')} for {ticker} due to illogical H/L relationship.")
                     continue
            except Exception as e:
                logging.error(f"Error processing candle data at index {i} for {ticker}: {candle}. Error: {e}")
                continue

            if last_candle_time is not None:
                time_diff_seconds = (candle_time - last_candle_time).total_seconds()
                if time_diff_seconds > 180 and position != 0:
                    halt_detected = True
                    logging.warning(f"Possible halt detected for {ticker} ending at {candle_time.strftime('%H:%M:%S')}. Gap: {time_diff_seconds / 60:.1f} min")
            last_candle_time = candle_time

            high_of_day = max(high_of_day, candle_high_price)

            highest_price_so_far = high_of_day
            highest_move = ((highest_price_so_far - day_open) / day_open) * 100 if day_open > 0 else 0

            if position != 0:
                price_history.append({
                    'time': candle_time, 'price': candle_close_price,
                    'high': candle_high_price, 'low': candle_low_price
                })

            if halt_detected and position != 0:
                 if candle_open_price > stop_loss:
                    logging.warning(f"Post-halt gap through stop loss for {ticker} at {candle_time.strftime('%H:%M:%S')}")
                    original_exit_price = candle_open_price
                    exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    exit_time = candle_time
                    pnl = (entry_price - exit_price) * abs(position)
                    exit_commission = calculate_commission(abs(position) * exit_price)
                    total_pnl = pnl - exit_commission
                    local_current_account_size += total_pnl
                    if trade:
                        trade.update({
                            'exit_time': exit_time, 'exit_price': exit_price, 'profit_loss': total_pnl,
                            'commission': trade['commission'] + exit_commission, 'exit_type': 'Halt Gap Stop',
                            'price_history': price_history, 'halt_detected': True,
                            'stop_loss_hit_candle': {'time': candle_time.strftime('%H:%M:%S'), 'open': candle_open_price, 'high': candle_high_price, 'low': candle_low_price, 'close': candle_close_price, 'volume': candle_volume },
                            'balance_after_trade': local_current_account_size })
                        trades.append(trade)
                        trade = None
                    else: logging.error(f"Halt stop triggered for {ticker}, but 'trade' dict was None.")
                    position = 0
                    halt_detected = False
                    price_history = []
                    trigger_detected = False  # Reset trigger
                    continue
                 else:
                    halt_detected = False

            if position < 0:
                if candle_high_price >= stop_loss or candle_open_price >= stop_loss:
                    original_exit_price = candle_open_price if candle_open_price >= stop_loss else stop_loss
                    exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    exit_time = candle_time
                    pnl = (entry_price - exit_price) * abs(position)
                    exit_commission = calculate_commission(abs(position) * exit_price)
                    total_pnl = pnl - exit_commission
                    local_current_account_size += total_pnl
                    if trade:
                        trade.update({
                            'exit_time': exit_time, 'exit_price': exit_price, 'profit_loss': total_pnl,
                            'commission': trade['commission'] + exit_commission, 'exit_type': 'Stop Loss',
                            'price_history': price_history,
                            'stop_loss_hit_candle': {'time': candle_time.strftime('%H:%M:%S'), 'open': candle_open_price, 'high': candle_high_price, 'low': candle_low_price, 'close': candle_close_price, 'volume': candle_volume },
                            'balance_after_trade': local_current_account_size })
                        trades.append(trade)
                        trade = None
                    else: logging.error(f"Stop loss triggered for {ticker}, but 'trade' dict was None.")
                    logging.info(f"Stop Loss Exit for {ticker} @ ${exit_price:.4f}, P&L: ${total_pnl:.2f}")
                    position = 0
                    price_history = []
                    trigger_detected = False  # Reset trigger
                    continue

                elif candle_hhmm >= INTRADAY_BACKSIDE_PARAMS['TIME_OF_DAY_MAX']:
                    original_exit_price = candle_close_price
                    if original_exit_price <= 0: original_exit_price = candle_open_price
                    if original_exit_price <= 0: original_exit_price = entry_price
                    exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                    exit_time = candle_time
                    pnl = (entry_price - exit_price) * abs(position)
                    exit_commission = calculate_commission(abs(position) * exit_price)
                    total_pnl = pnl - exit_commission
                    local_current_account_size += total_pnl
                    if trade:
                        trade.update({
                            'exit_time': exit_time, 'exit_price': exit_price, 'profit_loss': total_pnl,
                            'commission': trade['commission'] + exit_commission, 'exit_type': 'Time Cutoff',
                            'price_history': price_history, 'balance_after_trade': local_current_account_size })
                        trades.append(trade)
                        trade = None
                    else: logging.error(f"Time cutoff exit for {ticker}, but 'trade' dict was None.")
                    logging.info(f"Time Cutoff Exit for {ticker} @ ${exit_price:.4f}, P&L: ${total_pnl:.2f}")
                    position = 0
                    price_history = []
                    trigger_detected = False  # Reset trigger
                    continue

            # MODIFIED: Check for trigger detection
            if position == 0 and not trigger_detected and candle_hhmm <= INTRADAY_BACKSIDE_PARAMS['TIME_OF_DAY_MAX']:

                if not move_qualified:
                     if highest_move >= INTRADAY_BACKSIDE_PARAMS['MIN_PRICE_MOVE_PERCENT']:
                         move_qualified = True
                         qualify_time = candle_time
                         logging.info(f"{ticker} qualified: Min move {INTRADAY_BACKSIDE_PARAMS['MIN_PRICE_MOVE_PERCENT']}% ({highest_move:.2f}%) at {qualify_time.strftime('%H:%M:%S')}")
                     else: continue

                if move_qualified:
                    pullback = 0.0
                    if high_of_day > day_open:
                        pullback = ((high_of_day - candle_low_price) / (high_of_day - day_open)) * 100
                    if not pullback_qualified and pullback >= INTRADAY_BACKSIDE_PARAMS['MIN_PULLBACK_PERCENT']:
                        pullback_qualified = True
                        logging.info(f"{ticker} qualified: Min pullback {INTRADAY_BACKSIDE_PARAMS['MIN_PULLBACK_PERCENT']}% ({pullback:.2f}%) at {candle_time.strftime('%H:%M:%S')}")
                    if not pullback_qualified: continue

                    if pullback_qualified:
                        stuffWindow, stuffWindow2, stuffCandleHard = False, False, False
                        try:
                            if i >= 20:
                                open20 = float(market_hours_data_for_loop[i-20].get('o',0))
                                highs20 = [float(c.get('h',0)) for c in market_hours_data_for_loop[max(0,i-20):i+1]]
                                high20 = max(highs20) if highs20 else 0
                                cond20 = 1.0 if candle_close_price >= 8 else 0.2
                                if open20 > 0 and high20 > 0: stuffWindow = (high20-open20 > cond20) and (candle_close_price < open20)
                            if i >= 5:
                                open5 = float(market_hours_data_for_loop[i-5].get('o',0))
                                highs5 = [float(c.get('h',0)) for c in market_hours_data_for_loop[max(0,i-5):i+1]]
                                high5 = max(highs5) if highs5 else 0
                                cond5 = 1.4 if candle_close_price >= 8 else 0.25
                                if open5 > 0 and high5 > 0: stuffWindow2 = (high5-open5 > cond5) and (candle_close_price < open5)
                            condH = 0.7 if candle_close_price >= 8 else 0.2
                            volCondH = 600000 if candle_close_price >= 8 else 900000
                            if candle_open_price > 0:
                                highMinusOpen = candle_high_price - candle_open_price
                                closeLTopen = candle_close_price < candle_open_price
                                volChkH = candle_volume > volCondH
                                stuffCandleHard = highMinusOpen > condH and closeLTopen and volChkH
                        except Exception as stuff_e: logging.warning(f"Error calculating stuff for {ticker} at {candle_time}: {stuff_e}")
                        stuff_condition_met = stuffWindow or stuffWindow2 or stuffCandleHard

                        cumulative_volume = sum(int(c.get('v', 0)) for c in market_hours_data_for_loop[:i+1])
                        volume_check_passed = cumulative_volume >= 1000000

                        if stuff_condition_met and volume_check_passed:
                            # MODIFIED: Mark trigger detected but don't enter yet
                            trigger_detected = True
                            trigger_candle_index = i
                            trigger_price = candle_close_price
                            
                            logging.info(f"TRIGGER DETECTED for {ticker} at {candle_time}, Price: ${trigger_price:.2f}")
                            logging.info(f"Will enter on NEXT candle open (if available)")
                            logging.info(f"Trigger conditions: StuffWindow={stuffWindow}, StuffWindow2={stuffWindow2}, StuffCandleHard={stuffCandleHard}")
                            logging.info(f"Cumulative volume: {cumulative_volume:,}")
            
            # MODIFIED: Enter position on the candle AFTER trigger detection
            elif position == 0 and trigger_detected and i == trigger_candle_index + 1:
                # This is the candle immediately after the trigger candle
                
                # Check if we're still within time limits
                if candle_hhmm <= INTRADAY_BACKSIDE_PARAMS['TIME_OF_DAY_MAX']:
                    original_entry_price = candle_open_price  # Use OPEN of next candle
                    if original_entry_price <= 0:
                         logging.warning(f"Invalid entry price {original_entry_price} for {ticker}. Skipping.")
                         trigger_detected = False  # Reset trigger
                         continue
                    entry_price = apply_slippage(original_entry_price, is_entry=True, is_short=True)

                    risk_amount = STATIC_RISK_AMOUNT_INTRADAY if USE_STATIC_POSITION_SIZING_INTRADAY else daily_starting_balance * (INTRADAY_BACKSIDE_PARAMS['RISK_PERCENTAGE'] / 100.0)
                    stop_loss = entry_price * (1 + INTRADAY_BACKSIDE_PARAMS['STOP_LOSS_PERCENT'])
                    risk_per_share = stop_loss - entry_price
                    if risk_per_share <= 0.01:
                        logging.warning(f"Risk per share ${risk_per_share:.4f} too small for {ticker}. Skipping.")
                        trigger_detected = False  # Reset trigger
                        continue
                    shares = int(risk_amount / risk_per_share)
                    if shares <= 0:
                         logging.warning(f"Shares ({shares}) invalid for {ticker}. Skipping.")
                         trigger_detected = False  # Reset trigger
                         continue

                    position = -shares
                    entry_commission = calculate_commission(abs(position) * entry_price)
                    price_history = [{'time': candle_time, 'price': candle_close_price, 'high': candle_high_price, 'low': candle_low_price}]
                    trade = {
                        'ticker': ticker, 'date': date.date(), 'entry_time': candle_time,
                        'entry_price': entry_price, 'original_entry_price': original_entry_price,
                        'entry_candle_details': {'time': candle_time.strftime('%H:%M:%S'), 'open': candle_open_price, 'high': candle_high_price, 'low': candle_low_price, 'close': candle_close_price, 'volume': candle_volume },
                        'shares': shares, 'commission': entry_commission, 'strategy': 'Intraday Backside',
                        'float_size': float_size, 'high_of_day_at_entry': high_of_day,
                        'move_percentage_at_entry': highest_move, 'pullback_percentage_at_entry': pullback,
                        'stop_loss': stop_loss,
                        'trigger_candle_index': trigger_candle_index,
                        'entry_candle_index': i,
                        'exit_time': None, 'exit_price': None, 'profit_loss': None, 'exit_type': None,
                        'price_history': [], 'trailing_stop_activated': False, 'balance_after_trade': None,
                        'halt_detected': False, 'stop_loss_hit_candle': None
                    }
                    logging.info(f"\nIntraday Backside Entry for {ticker} on {date.strftime('%Y-%m-%d')}:")
                    logging.info(f" Time: {candle_time.strftime('%H:%M:%S')}, Entry: ${entry_price:.4f} (OPEN of candle after trigger), Stop: ${stop_loss:.4f}, Shares: {shares}")
                    logging.info(f" HOD@entry: ${high_of_day:.4f}, Move%@entry: {highest_move:.2f}%, Pullback%@entry: {pullback:.2f}%")
                    logging.info(f" Trigger was detected on previous candle, entered on current candle open")
                else:
                    logging.info("Next candle after trigger is past TIME_OF_DAY_MAX; trade not taken")
                    trigger_detected = False  # Reset trigger

        if position != 0 and trade:
            try:
                last_candle = market_hours_data_for_loop[-1]
                last_candle_time = pd.to_datetime(last_candle.get('t'))
                original_exit_price = float(last_candle.get('c', 0.0))
                if original_exit_price <= 0: original_exit_price = float(last_candle.get('o', entry_price if entry_price > 0 else 0.1))
                if original_exit_price <= 0: original_exit_price = entry_price if entry_price > 0 else 0.1

                exit_price = apply_slippage(original_exit_price, is_entry=False, is_short=True)
                exit_time = last_candle_time
                pnl = (entry_price - exit_price) * abs(position)
                exit_commission = calculate_commission(abs(position) * exit_price)
                total_pnl = pnl - exit_commission
                local_current_account_size += total_pnl

                trade.update({
                    'exit_time': exit_time, 'exit_price': exit_price, 'profit_loss': total_pnl,
                    'commission': trade['commission'] + exit_commission, 'exit_type': 'EOD',
                    'price_history': price_history, 'balance_after_trade': local_current_account_size })
                trades.append(trade)
                logging.info(f"EOD Exit for {ticker} @ ${exit_price:.4f}, P&L: ${total_pnl:.2f}")
                position = 0
            except Exception as eod_e:
                 logging.error(f"Error during EOD exit for {ticker}: {eod_e}")
                 if trade:
                     trade.update({'exit_type': 'EOD Error', 'profit_loss': 0.0})
                     trades.append(trade)

        if trades:
            total_pnl_ticker = sum(t.get('profit_loss', 0.0) for t in trades)
            logging.info(f"\nIntraday Backside Summary for {ticker}: Total P&L: ${total_pnl_ticker:.2f}")

        return trades if trades else None

    except Exception as e:
        logging.error(f"Fatal error in simulate_intraday_backside_trade for {ticker} on {date.strftime('%Y-%m-%d')}: {str(e)}")
        logging.error(traceback.format_exc())
        return None

# ============================================================================
# MAIN PROCESSING FUNCTION
# ============================================================================

def process_day_trades(date, para_df, gap_df, backside_df, daily_starting_balance, winning_trade_count):
    
    daily_trades = []
    backside_eligible_tickers = set()
    gapper_backside_tickers = set()
    processed_tickers = set()
    daily_balance = daily_starting_balance

    logging.info(f"\n==========================================")
    logging.info(f"Processing trades for date: {date}")
    logging.info(f"Daily starting balance: ${daily_starting_balance:.2f}")
    logging.info(f"Winning trade count: {winning_trade_count}")

    # Process Gapper trades (skip Mondays)
    if date.weekday() != 0 and not gap_df.empty:
        gap_tickers = gap_df[gap_df['Date'].dt.date == date.date()]
        logging.info(f"Processing {len(gap_tickers)} Gapper tickers for {date}")
    else:
        if date.weekday() == 0:
            logging.info(f"Skipping Gapper trades for {date} (Monday)")
        gap_tickers = pd.DataFrame()
        
    for _, row in gap_tickers.iterrows():
        try:
            ticker = row['Symbol']
            if ticker in processed_tickers:
                continue
            
            intraday_data = fetch_intraday_data(ticker, date.strftime('%Y-%m-%d'))
            if intraday_data is not None:
                intraday_df = preprocess_data(intraday_data)
                if intraday_df is not None and not intraday_df.empty:
                    pre_market_data = intraday_df[intraday_df['t'].dt.time < time(9, 30)]
                    if not pre_market_data.empty:
                        pre_market_high = pre_market_data['h'].max()
                        yesterday_close = fetch_previous_close(ticker, date)
                        
                        if yesterday_close is not None:
                            result = simulate_gapper_trade(
                                intraday_df, 
                                ticker, 
                                date, 
                                daily_balance,
                                yesterday_close, 
                                pre_market_high, 
                                winning_trade_count, 
                                float_size=row.get('Float', 3000000)
                            )
                            
                            if result:
                                result['trailing_stop_activated'] = result.get('trailing_stop_activated', False)
                                result['balance_after_trade'] = daily_balance + result['profit_loss']
                                daily_balance = result['balance_after_trade']
                                daily_trades.append(result)
                                gapper_backside_tickers.add(ticker)
                                if result.get('backside_eligible', False):
                                    backside_eligible_tickers.add(ticker)
                                else:
                                    processed_tickers.add(ticker)
                                if result['profit_loss'] > 0:
                                    winning_trade_count += 1
        except Exception as e:
            logging.error(f"Error processing Gapper trade for {ticker}: {str(e)}")
            logging.error(traceback.format_exc())
            continue

    # Process normal Backside trades
    if not backside_df.empty:
        backside_tickers = backside_df[backside_df['Date'].dt.date == date.date()]
        logging.info(f"Processing Backside candidates for {date}")

        is_monday = (date.weekday() == 0)
        if is_monday:
            logging.info("Monday: Running Backside for ALL backside tickers (ignoring eligibility).")
        else:
            logging.info("Not Monday: Running Backside for eligible tickers only.")
            
        for _, row in backside_tickers.iterrows():
            try:
                ticker = row['Symbol']
                
                if (not is_monday) and (ticker not in backside_eligible_tickers):
                    logging.info(f"Skipping Backside for {ticker} - not eligible (no gapper stop out)")
                    continue

                if ticker in processed_tickers:
                    continue
                    
                intraday_data = fetch_intraday_data(ticker, date.strftime('%Y-%m-%d'))
                if intraday_data is not None:
                    intraday_df = preprocess_data(intraday_data)
                    if intraday_df is not None and not intraday_df.empty:
                        result = simulate_backside_trade_mac(
                            intraday_df, 
                            ticker, 
                            date, 
                            daily_balance,
                            winning_trade_count, 
                            row.get('Float', 3000000),
                            daily_starting_balance  
                        )
                        
                        if result:
                            if isinstance(result, list):
                                for trade in result:
                                    trade['trailing_stop_activated'] = trade.get('trailing_stop_activated', False)
                                    trade['balance_after_trade'] = daily_balance + trade['profit_loss']
                                    daily_balance = trade['balance_after_trade']
                                    daily_trades.append(trade)
                                    processed_tickers.add(ticker)
                                    if trade['profit_loss'] > 0:
                                        winning_trade_count += 1
                            else:
                                result['trailing_stop_activated'] = result.get('trailing_stop_activated', False)
                                result['balance_after_trade'] = daily_balance + result['profit_loss']
                                daily_balance = result['balance_after_trade']
                                daily_trades.append(result)
                                processed_tickers.add(ticker)
                                if result['profit_loss'] > 0:
                                    winning_trade_count += 1

            except Exception as e:
                logging.error(f"Error processing Backside trade for {ticker}: {str(e)}")
                logging.error(traceback.format_exc())
                continue

    # Process Intraday Backside trades (skip Mondays)
    try:
        if date.weekday() == 0:
            logging.info(f"Skipping Intraday Backside trades for {date} (Monday)")
        else:
            intraday_candidates = find_intraday_backside_candidates(date, POLYGON_API_KEY)
            if intraday_candidates:
                logging.info(f"Processing {len(intraday_candidates)} Intraday Backside candidates for {date}")
                
                for candidate in intraday_candidates:
                    try:
                        ticker = candidate['ticker']
                        
                        if ticker in gapper_backside_tickers:
                            logging.info(f"Skipping Intraday Backside for {ticker} - already traded")
                            continue
                            
                        intraday_data = fetch_intraday_data(ticker, date.strftime('%Y-%m-%d'))
                        if intraday_data is not None:
                            intraday_df = preprocess_data(intraday_data)
                            if intraday_df is not None and not intraday_df.empty:
                                result = simulate_intraday_backside_trade(
                                    intraday_df,
                                    ticker,
                                    date,
                                    daily_balance,
                                    winning_trade_count,
                                    float_size=3000000,
                                    daily_starting_balance=daily_starting_balance
                                )
                                
                                if result:
                                    if isinstance(result, list):
                                        for trade in result:
                                            trade['trailing_stop_activated'] = trade.get('trailing_stop_activated', False)
                                            trade['balance_after_trade'] = daily_balance + trade['profit_loss']
                                            daily_balance = trade['balance_after_trade']
                                            trade['strategy'] = 'Intraday Backside'
                                            daily_trades.append(trade)
                                            processed_tickers.add(ticker)
                                            if trade['profit_loss'] > 0:
                                                winning_trade_count += 1
                                    else:
                                        result['trailing_stop_activated'] = result.get('trailing_stop_activated', False)
                                        result['balance_after_trade'] = daily_balance + result['profit_loss']
                                        daily_balance = result['balance_after_trade']
                                        result['strategy'] = 'Intraday Backside'
                                        daily_trades.append(result)
                                        processed_tickers.add(ticker)
                                        if result['profit_loss'] > 0:
                                            winning_trade_count += 1

                    except Exception as e:
                        logging.error(f"Error processing Intraday Backside trade for {ticker}: {str(e)}")
                        logging.error(traceback.format_exc())
                        continue

    except Exception as e:
        logging.error(f"Error processing Intraday Backside candidates: {str(e)}")
        logging.error(traceback.format_exc())

    if daily_trades:
        logging.info(f"\nTrades for {date.strftime('%Y-%m-%d')}:")
        logging.info(f"Daily P&L: ${sum(t['profit_loss'] for t in daily_trades):.2f}")
        logging.info(f"Number of trades: {len(daily_trades)}")
        logging.info(f"Updated Account Size: ${daily_balance:.2f}")
        for trade in daily_trades:
            logging.info(f"Strategy: {trade['strategy']}, Ticker: {trade['ticker']}, P&L: ${trade['profit_loss']:.2f}")
    
    return daily_trades, winning_trade_count

# ============================================================================
# ANALYSIS & REPORTING FUNCTIONS
# ============================================================================

def calculate_equity_curve(trades_df):
    if trades_df.empty:
        # Use a default starting balance since initial_account_size may not be defined yet
        return pd.Series([100000])
        
    if not pd.api.types.is_datetime64_any_dtype(trades_df['date']):
        trades_df['date'] = pd.to_datetime(trades_df['date'])
    
    trades_df = trades_df.sort_values('date')
    daily_net_pnl = trades_df.groupby('date').apply(lambda x: x['profit_loss'].sum())
    
    # Use the starting balance from the trades data if available, otherwise use default
    if 'balance_after_trade' in trades_df.columns and not trades_df.empty:
        # Calculate starting balance from the first trade's balance
        first_trade = trades_df.iloc[0]
        starting_balance = first_trade['balance_after_trade'] - first_trade['profit_loss']
    else:
        starting_balance = 100000  # Default starting balance
    
    equity_curve = daily_net_pnl.cumsum() + starting_balance
    
    return equity_curve

def calculate_drawdown(equity_curve):
    peak = equity_curve.cummax()
    drawdown = (equity_curve - peak) / peak
    return drawdown

def calculate_rsi(data, periods=20):
    if len(data) < periods + 1:
        return pd.Series([float('nan')] * len(data), index=data.index)
        
    delta = data.diff()
    gains = delta.where(delta > 0, 0)
    losses = -delta.where(delta < 0, 0)
    
    avg_gains = gains.rolling(window=periods).mean()
    avg_losses = losses.rolling(window=periods).mean()
    
    rs = avg_gains / avg_losses
    rsi = 100 - (100 / (1 + rs))
    
    return rsi

def analyze_equity_curve_rsi(trades_df, initial_balance=100000):
   
    trades_df['date'] = pd.to_datetime(trades_df['date'])
    trades_df = trades_df.sort_values('date')
    
    daily_pnl = trades_df.groupby('date')['profit_loss'].sum().reset_index()
    daily_pnl['cumulative_pnl'] = daily_pnl['profit_loss'].cumsum()
    daily_pnl['equity'] = daily_pnl['cumulative_pnl'] + initial_balance
    
    if len(daily_pnl) >= 20:
        daily_pnl['rsi'] = calculate_rsi(daily_pnl['equity'], periods=20)
        
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), height_ratios=[2, 1])
        fig.suptitle('Equity Curve and RSI Analysis')
        
        ax1.plot(daily_pnl['date'], daily_pnl['equity'], 'b-', label='Equity Curve')
        ax1.set_ylabel('Account Value ($)')
        ax1.grid(True)
        ax1.legend()
        
        ax2.plot(daily_pnl['date'], daily_pnl['rsi'], 'g-', label='20-day RSI')
        ax2.axhline(y=85, color='r', linestyle='--', alpha=0.5, label='Overbought (85)')
        ax2.axhline(y=50, color='r', linestyle='--', alpha=0.5, label='Oversold (50)')
        ax2.fill_between(daily_pnl['date'], 85, 50, color='gray', alpha=0.1)
        ax2.set_ylabel('RSI')
        ax2.set_ylim(0, 100)
        ax2.grid(True)
        ax2.legend()
        
        plt.xlabel('Date')
        fig.autofmt_xdate()
        plt.tight_layout()
        plt.savefig(os.path.join(charts_dir, 'equity_rsi_analysis.png'))
        plt.close()
    else:
        daily_pnl['rsi'] = float('nan')
        logging.info(f"Insufficient data for RSI calculation. Need at least 20 days, but got {len(daily_pnl)} days.")
    
    daily_pnl['condition'] = 'Normal'
    daily_pnl.loc[daily_pnl['rsi'] > 85, 'condition'] = 'Overbought'
    daily_pnl.loc[daily_pnl['rsi'] < 50, 'condition'] = 'Oversold'
    
    return daily_pnl

def print_performance_summary(trades_df):
    if not pd.api.types.is_datetime64_any_dtype(trades_df['date']):
        trades_df['date'] = pd.to_datetime(trades_df['date'])
    
    trades_df['day_of_week'] = trades_df['date'].dt.day_name()
    
    daily_stats = trades_df.groupby('date').agg({
        'profit_loss': 'sum',
        'balance_after_trade': 'last'
    }).reset_index()
    
    daily_stats['starting_balance'] = daily_stats['balance_after_trade'].shift(1)
    daily_stats.loc[0, 'starting_balance'] = initial_account_size
    daily_stats['pnl_percentage'] = (daily_stats['profit_loss'] / daily_stats['starting_balance']) * 100
    
    best_day_pct = daily_stats['pnl_percentage'].max()
    worst_day_pct = daily_stats['pnl_percentage'].min()
    avg_win_day_pct = daily_stats[daily_stats['profit_loss'] > 0]['pnl_percentage'].mean()
    avg_loss_day_pct = daily_stats[daily_stats['profit_loss'] < 0]['pnl_percentage'].mean()
    
    best_day = daily_stats.loc[daily_stats['pnl_percentage'].idxmax()]
    worst_day = daily_stats.loc[daily_stats['pnl_percentage'].idxmin()]
    
    daily_pnl = trades_df.groupby('date')['profit_loss'].sum()
    profitable_days = (daily_pnl > 0).sum()
    unprofitable_days = (daily_pnl <= 0).sum()
    total_trading_days = len(daily_pnl)
    
    profitable_days_pct = (profitable_days / total_trading_days) * 100
    unprofitable_days_pct = (unprofitable_days / total_trading_days) * 100
    
    equity_curve = calculate_equity_curve(trades_df)
    initial_value = equity_curve.iloc[0]
    pct_change_curve = ((equity_curve / initial_account_size) - 1) * 100
    drawdown = calculate_drawdown(equity_curve)
    
    plot_equity_curve(equity_curve)
    plot_log_equity_curve(equity_curve)
    plot_drawdown(drawdown)
    
    monthly_data = plot_monthly_equity_curve(trades_df, initial_account_size, charts_dir)
    monthly_stats = add_monthly_analysis_to_summary(trades_df, initial_account_size)
    
    # Create percentage equity curve chart
    plt.figure(figsize=(12, 6))
    plt.plot(pct_change_curve.index, pct_change_curve.values)
    plt.title('Equity Curve - Percentage Change')
    plt.xlabel('Date')
    plt.ylabel('Percentage Change (%)')
    plt.grid(True)
    plt.xticks(rotation=45)
    plt.axhline(y=0, color='r', linestyle='-', alpha=0.3)
    
    milestones = [25, 50, 100, 200, 500, 1000]
    max_pct = pct_change_curve.max()
    
    for milestone in milestones:
        if max_pct >= milestone:
            plt.axhline(y=milestone, color='g', linestyle='--', alpha=0.3)
            plt.text(pct_change_curve.index[0], milestone, f"+{milestone}%", 
                    verticalalignment='bottom', color='green')
    
    plt.tight_layout()
    plt.savefig(os.path.join(charts_dir, 'equity_curve_percent.png'))
    plt.close()
    
    # Create combined chart with dual axis
    fig, ax1 = plt.subplots(figsize=(14, 7))
    
    color = 'tab:blue'
    ax1.set_xlabel('Date')
    ax1.set_ylabel('Account Value ($)', color=color)
    ax1.plot(equity_curve.index, equity_curve.values, color=color)
    ax1.tick_params(axis='y', labelcolor=color)
    ax1.grid(True, alpha=0.3)
    
    ax2 = ax1.twinx()
    color = 'tab:red'
    ax2.set_ylabel('Percentage Change (%)', color=color)
    ax2.plot(pct_change_curve.index, pct_change_curve.values, color=color, linestyle='--')
    ax2.tick_params(axis='y', labelcolor=color)
    
    for milestone in [25, 50, 100, 200, 500, 1000]:
        if max_pct >= milestone:
            ax2.axhline(y=milestone, color='green', linestyle=':', alpha=0.2)
    
    plt.title('Equity Curve - Absolute Values and Percentage Change')
    fig.tight_layout()
    plt.savefig(os.path.join(charts_dir, 'equity_curve_combined.png'))
    plt.close()
    
    # Separate trades by strategy
    gapper_trades = trades_df[trades_df['strategy'] == 'Gapper']
    backside_trades = trades_df[trades_df['strategy'] == 'Backside']
    intraday_backside_trades = trades_df[trades_df['strategy'] == 'Intraday Backside']

    # Analyze trailing stop performance
    trailing_stop_trades = trades_df[trades_df['trailing_stop_activated'] == True]
    
    logging.info("\nTrailing Stop Analysis:")
    if not trailing_stop_trades.empty:
        trailing_stop_pnl = trailing_stop_trades['profit_loss'].sum()
        trailing_stop_win_rate = (trailing_stop_trades['profit_loss'] > 0).mean()
        avg_trailing_stop_profit = trailing_stop_trades[trailing_stop_trades['profit_loss'] > 0]['profit_loss'].mean()
        avg_trailing_stop_loss = trailing_stop_trades[trailing_stop_trades['profit_loss'] < 0]['profit_loss'].mean()
        
        logging.info(f"Trades with trailing stop activated: {len(trailing_stop_trades)}")
        logging.info(f"Trailing stop win rate: {trailing_stop_win_rate:.2%}")
        logging.info(f"Total P&L from trailing stop trades: ${trailing_stop_pnl:.2f}")
        logging.info(f"Average profit on winning trailing stop trades: ${avg_trailing_stop_profit:.2f}")
        logging.info(f"Average loss on losing trailing stop trades: ${avg_trailing_stop_loss:.2f}")
    else:
        logging.info("No trades triggered trailing stop")
    
    # Print daily profitability statistics
    logging.info("\nDaily Profitability Statistics:")
    logging.info(f"Total Trading Days: {total_trading_days}")
    logging.info(f"Profitable Days: {profitable_days} ({profitable_days_pct:.2f}%)")
    logging.info(f"Unprofitable Days: {unprofitable_days} ({unprofitable_days_pct:.2f}%)")
    logging.info(f"Average Daily P&L: ${daily_pnl.mean():.2f}")
    logging.info(f"Best Day: ${daily_pnl.max():.2f}")
    logging.info(f"Worst Day: ${daily_pnl.min():.2f}")
    
    # Print percentage-based statistics
    logging.info("\nAccount Balance Percentage Statistics:")
    logging.info(f"Best Day: +{best_day_pct:.2f}% (${best_day['profit_loss']:.2f} on {best_day['date'].strftime('%Y-%m-%d')})")
    logging.info(f"Worst Day: {worst_day_pct:.2f}% (${worst_day['profit_loss']:.2f} on {worst_day['date'].strftime('%Y-%m-%d')})")
    logging.info(f"Average Winning Day: +{avg_win_day_pct:.2f}% of account balance")
    logging.info(f"Average Losing Day: {avg_loss_day_pct:.2f}% of account balance")

    logging.info("\nPerformance Summary:")
    gross_profit = trades_df['profit_loss'].sum() + trades_df['commission'].sum()
    total_commission = trades_df['commission'].sum()
    net_profit = trades_df['profit_loss'].sum()
    
    logging.info(f"Total Gross Profit: ${gross_profit:.2f}")
    logging.info(f"  Gapper Strategy Profit: ${gapper_trades['profit_loss'].sum() + gapper_trades['commission'].sum():.2f}")
    logging.info(f"  Backside Strategy Profit: ${backside_trades['profit_loss'].sum() + backside_trades['commission'].sum():.2f}")
    logging.info(f"  Intraday Backside Profit: ${intraday_backside_trades['profit_loss'].sum() + intraday_backside_trades['commission'].sum():.2f}")
    logging.info(f"Total Commission: ${total_commission:.2f}")
    logging.info(f"Total Net Profit: ${net_profit:.2f}")
    
    # Print win rates for each strategy
    if not gapper_trades.empty:
        logging.info(f"Gapper Strategy Win Rate: {(gapper_trades['profit_loss'] > 0).mean():.2%}")
    if not backside_trades.empty:
        logging.info(f"Backside Strategy Win Rate: {(backside_trades['profit_loss'] > 0).mean():.2%}")
    if not intraday_backside_trades.empty:
        logging.info(f"Intraday Backside Win Rate: {(intraday_backside_trades['profit_loss'] > 0).mean():.2%}")
    
    logging.info(f"Max Drawdown: {drawdown.min()*100:.2f}%")
    logging.info(f"Final Account Value: ${equity_curve.iloc[-1]:.2f}")
    logging.info(f"Final Percentage Gain: {pct_change_curve.iloc[-1]:.2f}%")
    
    # Add trailing stop statistics by strategy
    for strategy in ['Gapper', 'Backside']:
        strategy_trades = trades_df[trades_df['strategy'] == strategy]
        strategy_ts_trades = strategy_trades[strategy_trades['trailing_stop_activated'] == True]
        
        if not strategy_ts_trades.empty:
            logging.info(f"\n{strategy} Strategy Trailing Stop Analysis:")
            ts_win_rate = (strategy_ts_trades['profit_loss'] > 0).mean()
            ts_pnl = strategy_ts_trades['profit_loss'].sum()
            logging.info(f"Trailing stop trades: {len(strategy_ts_trades)}")
            logging.info(f"Win rate: {ts_win_rate:.2%}")
            logging.info(f"Total P&L: ${ts_pnl:.2f}")
    
    # Analyze each strategy by day of week
    logging.info("\nDay of Week Analysis:")
    
    def analyze_strategy_by_day(strategy_trades, strategy_name):
        if len(strategy_trades) == 0:
            logging.info(f"\n{strategy_name} Strategy: No trades found")
            return
            
        logging.info(f"\n{strategy_name} Strategy:")
        
        day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        
        for day in day_order:
            day_trades = strategy_trades[strategy_trades['day_of_week'] == day]
            if not day_trades.empty:
                trades_count = len(day_trades)
                total_pnl = day_trades['profit_loss'].sum()
                avg_pnl = total_pnl / trades_count
                win_rate = (day_trades['profit_loss'] > 0).mean()
                
                ts_trades = day_trades[day_trades['trailing_stop_activated'] == True]
                ts_count = len(ts_trades)
                ts_pnl = ts_trades['profit_loss'].sum() if ts_count > 0 else 0
                
                logging.info(f"{day}:")
                logging.info(f"  Number of Trades: {trades_count}")
                logging.info(f"  Total P&L: ${total_pnl:,.2f}")
                logging.info(f"  Average P&L per Trade: ${avg_pnl:,.2f}")
                logging.info(f"  Win Rate: {win_rate:.2%}")
                if ts_count > 0:
                    logging.info(f"  Trailing Stop Trades: {ts_count}")
                    logging.info(f"  Trailing Stop P&L: ${ts_pnl:,.2f}")
    
    # Analyze each strategy
    analyze_strategy_by_day(gapper_trades, "Gapper")
    analyze_strategy_by_day(backside_trades, "Backside")
    analyze_strategy_by_day(intraday_backside_trades, "Intraday Backside")
    
    # Create day of week performance chart
    plt.figure(figsize=(15, 5))
    
    day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    
    gapper_daily_avg = gapper_trades.groupby('day_of_week')['profit_loss'].mean().reindex(day_order)
    backside_daily_avg = backside_trades.groupby('day_of_week')['profit_loss'].mean().reindex(day_order)
    intraday_daily_avg = intraday_backside_trades.groupby('day_of_week')['profit_loss'].mean().reindex(day_order)
    
    x = np.arange(len(day_order))
    width = 0.25
    
    plt.bar(x - width, gapper_daily_avg, width, label='Gapper', color='blue', alpha=0.7)
    plt.bar(x, backside_daily_avg, width, label='Backside', color='green', alpha=0.7)
    plt.bar(x + width, intraday_daily_avg, width, label='Intraday Backside', color='red', alpha=0.7)
    
    plt.xlabel('Day of Week')
    plt.ylabel('Average P&L ($)')
    plt.title('Average P&L by Day of Week and Strategy')
    plt.xticks(x, day_order)
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(charts_dir, 'day_of_week_analysis.png'))
    plt.close()

    return daily_pnl

# ============================================================================
# CHARTING FUNCTIONS
# ============================================================================

def plot_equity_curve(equity_curve):
    plt.figure(figsize=(12, 6))
    plt.plot(equity_curve.index, equity_curve.values)
    plt.title('Equity Curve')
    plt.xlabel('Date')
    plt.ylabel('Account Value ($)')
    plt.grid(True)
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(os.path.join(charts_dir, 'equity_curve.png'))
    plt.close()

def plot_log_equity_curve(equity_curve):
    
    print("Starting improved plot_log_equity_curve function...")
    
    base_dir = r"C:\Users\maxma\OneDrive\Desktop\Algo Tests"
    charts_dir = os.path.join(base_dir, "trade_charts")
    
    if not os.path.exists(charts_dir):
        os.makedirs(charts_dir)
        print(f"Created directory: {charts_dir}")
    
    if isinstance(equity_curve, dict):
        dates = list(equity_curve.keys())
        values = list(equity_curve.values())
        equity_series = pd.Series(values, index=pd.to_datetime(dates))
    else:
        equity_series = equity_curve.copy()
    
    if not isinstance(equity_series.index, pd.DatetimeIndex):
        equity_series.index = pd.to_datetime(equity_series.index)
    
    equity_series = equity_series.sort_index()
    equity_daily = equity_series.resample('D').last().ffill()
    
    print(f"Analyzing equity curve with {len(equity_daily)} daily data points...")
    
    # IMPROVED STAGNATION DETECTION
    # Method 1: Periods without new equity highs
    stagnation_periods = []
    current_stagnation_start = None
    running_high = equity_daily.iloc[0]
    min_stagnation_days = 14  # Minimum 2 weeks to be considered stagnation
    new_high_threshold = 1.02  # Must exceed previous high by 2% to count as "new high"
    
    print(f"Detecting stagnation periods (min {min_stagnation_days} days, {(new_high_threshold-1)*100:.1f}% new high threshold)...")
    
    for i, (date, value) in enumerate(equity_daily.items()):
        # Check if we have a meaningful new high
        if value > running_high * new_high_threshold:
            # We have a new high - end any current stagnation period
            if current_stagnation_start is not None:
                stagnation_length = (date - current_stagnation_start).days
                if stagnation_length >= min_stagnation_days:
                    stagnation_periods.append((current_stagnation_start, date, stagnation_length))
                    print(f"Stagnation period: {current_stagnation_start.strftime('%Y-%m-%d')} to {date.strftime('%Y-%m-%d')} ({stagnation_length} days)")
                current_stagnation_start = None
            running_high = value
        else:
            # No new high - start or continue stagnation period
            if current_stagnation_start is None:
                current_stagnation_start = date
    
    # Handle case where stagnation period extends to the end
    if current_stagnation_start is not None:
        final_date = equity_daily.index[-1]
        stagnation_length = (final_date - current_stagnation_start).days
        if stagnation_length >= min_stagnation_days:
            stagnation_periods.append((current_stagnation_start, final_date, stagnation_length))
            print(f"Ongoing stagnation period: {current_stagnation_start.strftime('%Y-%m-%d')} to {final_date.strftime('%Y-%m-%d')} ({stagnation_length} days)")
    
    # Method 2: Flat performance periods (alternative detection)
    flat_periods = []
    window_days = 30  # Look at 30-day windows
    max_acceptable_progress = 0.05  # 5% progress over 30 days
    
    for i in range(window_days, len(equity_daily)):
        window_start_idx = i - window_days
        window_start_value = equity_daily.iloc[window_start_idx]
        window_end_value = equity_daily.iloc[i]
        
        # Calculate progress over the window
        progress = (window_end_value - window_start_value) / window_start_value
        
        if abs(progress) < max_acceptable_progress:
            window_start_date = equity_daily.index[window_start_idx]
            window_end_date = equity_daily.index[i]
            
            # Check if this overlaps with existing flat periods
            overlap = any(window_start_date <= end and window_end_date >= start 
                         for start, end, _ in flat_periods)
            
            if not overlap:
                flat_periods.append((window_start_date, window_end_date, window_days))
    
    print(f"Found {len(stagnation_periods)} stagnation periods (no new highs)")
    print(f"Found {len(flat_periods)} flat periods ({max_acceptable_progress*100:.1f}% progress over {window_days} days)")
    
    # Create the plot
    plt.figure(figsize=(16, 10))
    plt.semilogy(equity_series.index, equity_series.values, linewidth=2, color='blue', label='Log Equity Curve')
    
    # Plot stagnation periods (no new highs)
    for i, (start_date, end_date, days) in enumerate(stagnation_periods):
        plt.axvspan(start_date, end_date, alpha=0.4, color='red', zorder=10, 
                   label=f'Stagnation Period ({days}d)' if i == 0 else "")
    
    # Plot flat periods with different color
    for i, (start_date, end_date, days) in enumerate(flat_periods):
        plt.axvspan(start_date, end_date, alpha=0.2, color='orange', zorder=5, 
                   label=f'Flat Period ({days}d window)' if i == 0 else "")
    
    # Add vertical lines at equity peaks
    peaks = []
    running_max = equity_daily.iloc[0]
    for date, value in equity_daily.items():
        if value > running_max * new_high_threshold:
            peaks.append((date, value))
            running_max = value
    
    if peaks:
        peak_dates, peak_values = zip(*peaks)
        plt.scatter(peak_dates, peak_values, color='green', s=50, alpha=0.7, zorder=15, 
                   label=f'New Equity Highs (>{(new_high_threshold-1)*100:.1f}%)')
    
    # Enhanced title with statistics
    total_stagnation_days = sum(days for _, _, days in stagnation_periods)
    total_trading_days = (equity_daily.index[-1] - equity_daily.index[0]).days
    stagnation_percentage = (total_stagnation_days / total_trading_days) * 100 if total_trading_days > 0 else 0
    
    plt.title(f'Logarithmic Equity Curve with Stagnation Analysis\n'
              f'{len(stagnation_periods)} stagnation periods totaling {total_stagnation_days} days '
              f'({stagnation_percentage:.1f}% of trading period)', 
              fontsize=14, fontweight='bold')
    
    plt.xlabel('Date', fontsize=12)
    plt.ylabel('Account Value ($) - Log Scale', fontsize=12)
    plt.grid(True, which='both', linestyle='--', alpha=0.5)
    plt.xticks(rotation=45)
    plt.legend(loc='upper left')
    
    # Add text box with detailed statistics
    if stagnation_periods:
        longest_stagnation = max(stagnation_periods, key=lambda x: x[2])
        stats_text = f'Longest Stagnation: {longest_stagnation[2]} days\n'
        stats_text += f'({longest_stagnation[0].strftime("%Y-%m-%d")} to {longest_stagnation[1].strftime("%Y-%m-%d")})\n'
        stats_text += f'Total Stagnation: {total_stagnation_days} days ({stagnation_percentage:.1f}%)\n'
        stats_text += f'New Highs: {len(peaks)} times'
        
        plt.text(0.02, 0.98, stats_text, 
                transform=plt.gca().transAxes, fontsize=10, fontweight='bold',
                bbox=dict(boxstyle="round,pad=0.5", facecolor="lightyellow", alpha=0.8),
                verticalalignment='top')
    
    chart_path = os.path.join(charts_dir, "log_equity_curve_improved.png")
    plt.tight_layout()
    plt.savefig(chart_path, dpi=300, bbox_inches='tight')
    plt.close()
    
    print(f"Improved chart saved to: {chart_path}")
    
    # Print detailed stagnation analysis
    print(f"\n{'='*60}")
    print("DETAILED STAGNATION ANALYSIS")
    print(f"{'='*60}")
    
    if stagnation_periods:
        print(f"Stagnation periods (no meaningful new highs for >{min_stagnation_days} days):")
        for i, (start, end, days) in enumerate(stagnation_periods, 1):
            start_value = equity_daily.loc[start]
            end_value = equity_daily.loc[end]
            change_pct = ((end_value - start_value) / start_value) * 100
            print(f"  {i}. {start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')}")
            print(f"     Duration: {days} days")
            print(f"     Start value: ${start_value:,.0f}")
            print(f"     End value: ${end_value:,.0f}")
            print(f"     Change: {change_pct:+.1f}%")
            print()
    else:
        print("No significant stagnation periods detected.")
    
    if flat_periods:
        print(f"Flat periods (minimal progress over {window_days}-day windows):")
        for i, (start, end, days) in enumerate(flat_periods[:5], 1):  # Show first 5
            print(f"  {i}. {start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')} ({days} days)")
        if len(flat_periods) > 5:
            print(f"  ... and {len(flat_periods) - 5} more")
    
    return stagnation_periods, flat_periods

def plot_drawdown(drawdown):
    plt.figure(figsize=(12, 6))
    plt.plot(drawdown.index, drawdown.values * 100)
    plt.title('Drawdown')
    plt.xlabel('Date')
    plt.ylabel('Drawdown (%)')
    plt.grid(True)
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(os.path.join(charts_dir, 'drawdown.png'))
    plt.close()

def plot_monthly_equity_curve(trades_df, initial_account_size, charts_dir):
    try:
        if not pd.api.types.is_datetime64_any_dtype(trades_df['date']):
            trades_df['date'] = pd.to_datetime(trades_df['date'])
        
        daily_pnl = trades_df.groupby('date')['profit_loss'].sum()
        daily_equity = daily_pnl.cumsum() + initial_account_size
        monthly_equity = daily_equity.resample('ME').last()  # Fixed: Use 'ME' instead of 'M'
        monthly_pct_increase = ((monthly_equity / initial_account_size) - 1) * 100
        
        # Check if we have enough data for monthly analysis
        if len(monthly_equity) < 1:
            print("Insufficient data for monthly equity curve")
            return None
            
        # For single data points, create a simple summary instead of a chart
        if len(monthly_equity) == 1:
            print(f"\nMonthly Equity Curve Statistics (Single Month):")
            print(f"  Month: {monthly_equity.index[0].strftime('%Y-%m')}")
            print(f"  Equity: ${monthly_equity.iloc[0]:,.2f}")
            print(f"  Percentage Change: {monthly_pct_increase.iloc[0]:.2f}%")
            print("  Note: Skipping chart generation for single data point")
            return monthly_pct_increase
        
        # Set reasonable figure size and DPI
        plt.figure(figsize=(14, 8))
        plt.plot(monthly_pct_increase.index, monthly_pct_increase.values, 
                marker='o', linewidth=2, markersize=6, color='blue', alpha=0.8)
        
        for i, (date, value) in enumerate(monthly_pct_increase.items()):
            plt.annotate(f'{value:.1f}%', 
                        (date, value), 
                        textcoords="offset points", 
                        xytext=(0,10), 
                        ha='center', 
                        fontsize=8,
                        alpha=0.8)
        
        plt.title('Monthly Equity Curve - Cumulative Percentage Increase', fontsize=16, fontweight='bold')
        plt.xlabel('Month', fontsize=12)
        plt.ylabel('Cumulative Percentage Increase (%)', fontsize=12)
        plt.grid(True, alpha=0.3)
        
        reference_lines = [0, 25, 50, 100, 200, 500]
        max_value = monthly_pct_increase.max()
        min_value = monthly_pct_increase.min()
        
        for ref_line in reference_lines:
            if min_value <= ref_line <= max_value + 50:
                color = 'red' if ref_line == 0 else 'green'
                alpha = 0.5 if ref_line == 0 else 0.2
                plt.axhline(y=ref_line, color=color, linestyle='--', alpha=alpha)
                plt.text(monthly_pct_increase.index[0], ref_line, f'{ref_line}%', 
                        verticalalignment='bottom', color=color, fontsize=9, alpha=0.7)
        
        plt.xticks(rotation=45)
        
        # Fix the Y-axis scaling issue
        y_range = max_value - min_value
        if y_range == 0:  # Single point case
            y_margin = max(abs(max_value) * 0.1, 10)  # 10% margin or minimum 10 units
            plt.ylim(min_value - y_margin, max_value + y_margin)
        else:
            plt.ylim(min_value - y_range * 0.1, max_value + y_range * 0.1)
        
        # Use lower DPI to prevent oversized images
        chart_path = os.path.join(charts_dir, 'monthly_equity_curve.png')
        plt.savefig(chart_path, dpi=150, bbox_inches='tight')  # Reduced from 300 to 150
        plt.close()
        
        # Create bar chart version with similar fixes
        plt.figure(figsize=(14, 8))
        colors = ['green' if x >= 0 else 'red' for x in monthly_pct_increase.values]
        bars = plt.bar(monthly_pct_increase.index, monthly_pct_increase.values, 
                      color=colors, alpha=0.7, edgecolor='black', linewidth=0.5)
        
        for bar, value in zip(bars, monthly_pct_increase.values):
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2., height + (2 if height >= 0 else -5),
                    f'{value:.1f}%', ha='center', va='bottom' if height >= 0 else 'top', 
                    fontsize=8, fontweight='bold')
        
        plt.title('Monthly Equity Curve - Bar Chart View', fontsize=16, fontweight='bold')
        plt.xlabel('Month', fontsize=12)
        plt.ylabel('Cumulative Percentage Increase (%)', fontsize=12)
        plt.grid(True, alpha=0.3, axis='y')
        plt.xticks(rotation=45)
        plt.axhline(y=0, color='black', linestyle='-', alpha=0.8, linewidth=1)
        
        # Fix Y-axis for bar chart too
        if y_range == 0:
            y_margin = max(abs(max_value) * 0.1, 10)
            plt.ylim(min_value - y_margin, max_value + y_margin)
        
        bar_chart_path = os.path.join(charts_dir, 'monthly_equity_curve_bars.png')
        plt.savefig(bar_chart_path, dpi=150, bbox_inches='tight')  # Reduced DPI
        plt.close()
        
        print(f"\nMonthly Equity Curve Statistics:")
        print(f"  Total months: {len(monthly_pct_increase)}")
        print(f"  Best month-end: {max_value:.2f}% ({monthly_pct_increase.idxmax().strftime('%Y-%m')})")
        print(f"  Worst month-end: {min_value:.2f}% ({monthly_pct_increase.idxmin().strftime('%Y-%m')})")
        print(f"  Final month-end: {monthly_pct_increase.iloc[-1]:.2f}%")
        print(f"  Chart saved to: {chart_path}")
        print(f"  Bar chart saved to: {bar_chart_path}")
        
        return monthly_pct_increase
        
    except Exception as e:
        print(f"Error creating monthly equity curve: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def add_monthly_analysis_to_summary(trades_df, initial_account_size):
    """
    Add monthly analysis to the performance summary
    """
    try:
        if not pd.api.types.is_datetime64_any_dtype(trades_df['date']):
            trades_df['date'] = pd.to_datetime(trades_df['date'])
        
        daily_pnl = trades_df.groupby('date')['profit_loss'].sum()
        daily_equity = daily_pnl.cumsum() + initial_account_size
        
        monthly_pnl = trades_df.groupby(trades_df['date'].dt.to_period('M'))['profit_loss'].sum()
        monthly_trades = trades_df.groupby(trades_df['date'].dt.to_period('M')).size()
        monthly_equity = daily_equity.resample('M').last()
        monthly_pct_change = ((monthly_equity / initial_account_size) - 1) * 100
        monthly_equity_pct_change = monthly_equity.pct_change() * 100
        
        print("\n" + "="*60)
        print("MONTHLY PERFORMANCE ANALYSIS")
        print("="*60)
        
        # Overall monthly statistics
        profitable_months = (monthly_pnl > 0).sum()
        total_months = len(monthly_pnl)
        monthly_win_rate = (profitable_months / total_months) * 100 if total_months > 0 else 0
        
        print(f"Total Months Analyzed: {total_months}")
        print(f"Profitable Months: {profitable_months} ({monthly_win_rate:.1f}%)")
        print(f"Unprofitable Months: {total_months - profitable_months} ({100 - monthly_win_rate:.1f}%)")
        
        if len(monthly_pnl) > 0:
            print(f"Average Monthly P&L: ${monthly_pnl.mean():.2f}")
            print(f"Best Month P&L: ${monthly_pnl.max():.2f} ({monthly_pnl.idxmax()})")
            print(f"Worst Month P&L: ${monthly_pnl.min():.2f} ({monthly_pnl.idxmin()})")
            print(f"Monthly P&L Std Dev: ${monthly_pnl.std():.2f}")
        
        # Month-over-month percentage changes
        if len(monthly_equity_pct_change.dropna()) > 0:
            mom_changes = monthly_equity_pct_change.dropna()
            print(f"\nMonth-over-Month Performance:")
            print(f"Average Monthly Return: {mom_changes.mean():.2f}%")
            print(f"Best Monthly Return: {mom_changes.max():.2f}% ({mom_changes.idxmax().strftime('%Y-%m')})")
            print(f"Worst Monthly Return: {mom_changes.min():.2f}% ({mom_changes.idxmin().strftime('%Y-%m')})")
            print(f"Monthly Return Volatility: {mom_changes.std():.2f}%")
        
        # Cumulative performance by month-end
        if len(monthly_pct_change) > 0:
            print(f"\nCumulative Performance by Month-End:")
            print(f"Best Month-End Performance: {monthly_pct_change.max():.2f}% ({monthly_pct_change.idxmax().strftime('%Y-%m')})")
            print(f"Worst Month-End Performance: {monthly_pct_change.min():.2f}% ({monthly_pct_change.idxmin().strftime('%Y-%m')})")
            print(f"Final Month-End Performance: {monthly_pct_change.iloc[-1]:.2f}%")
        
        # Trading activity by month
        if len(monthly_trades) > 0:
            print(f"\nTrading Activity by Month:")
            print(f"Average Trades per Month: {monthly_trades.mean():.1f}")
            print(f"Most Active Month: {monthly_trades.max()} trades ({monthly_trades.idxmax()})")
            print(f"Least Active Month: {monthly_trades.min()} trades ({monthly_trades.idxmin()})")
        
        # Month-by-month breakdown (last 12 months or all if less than 12)
        recent_months = min(12, len(monthly_pnl))
        print(f"\nLast {recent_months} Months Breakdown:")
        print("-" * 50)
        
        for i in range(-recent_months, 0):
            period = monthly_pnl.index[i]
            pnl = monthly_pnl.iloc[i]
            trades = monthly_trades.iloc[i] if i < len(monthly_trades) else 0
            cumulative_pct = monthly_pct_change.iloc[i] if i < len(monthly_pct_change) else 0
            
            status = "📈" if pnl > 0 else "📉" if pnl < 0 else "➖"
            print(f"{period}: {status} ${pnl:8.2f} | {trades:2d} trades | {cumulative_pct:6.1f}% cumulative")
        
        return {
            'monthly_pnl': monthly_pnl,
            'monthly_trades': monthly_trades,
            'monthly_equity': monthly_equity,
            'monthly_pct_change': monthly_pct_change,
            'monthly_win_rate': monthly_win_rate
        }
        
    except Exception as e:
        print(f"Error in monthly analysis: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def create_strategy_charts(trades_df):
    for strategy in ['Para', 'Gapper', 'Backside']:
        strategy_trades = trades_df[trades_df['strategy'] == strategy]
        if strategy_trades.empty:
            continue

        # Equity curve
        plt.figure(figsize=(12, 6))
        plt.plot(strategy_trades['date'], strategy_trades['balance_after_trade'])
        plt.title(f'{strategy} Strategy Equity Curve')
        plt.xlabel('Date')
        plt.ylabel('Account Value ($)')
        plt.grid(True)
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.savefig(os.path.join(charts_dir, f'{strategy.lower()}_equity_curve.png'))
        plt.close()

        # Win rate by day
        plt.figure(figsize=(10, 6))
        daily_winrate = strategy_trades.groupby('day_of_week')['profit_loss'].apply(
            lambda x: (x > 0).mean()
        ).reindex(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
        daily_winrate.plot(kind='bar')
        plt.title(f'{strategy} Win Rate by Day')
        plt.xlabel('Day of Week')
        plt.ylabel('Win Rate')
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        plt.savefig(os.path.join(charts_dir, f'{strategy.lower()}_winrate.png'))
        plt.close()

        # P&L Distribution
        plt.figure(figsize=(10, 6))
        plt.hist(strategy_trades['profit_loss'], bins=50)
        plt.title(f'{strategy} P&L Distribution')
        plt.xlabel('Profit/Loss ($)')
        plt.ylabel('Frequency')
        plt.grid(True)
        plt.tight_layout()
        plt.savefig(os.path.join(charts_dir, f'{strategy.lower()}_pnl_dist.png'))
        plt.close()

# ============================================================================
# EXPORT FUNCTIONS
# ============================================================================

def save_trade_results(trades_df, base_filename):
    """
    Save trade results to CSV with error handling
    """
    from time import sleep
    
    max_attempts = 5
    for attempt in range(max_attempts):
        try:
            if attempt == 0:
                filename = os.path.join(current_dir, f'{base_filename}.csv')
            else:
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = os.path.join(current_dir, f'{base_filename}_{timestamp}.csv')
            
            trades_df.to_csv(filename, index=False)
            logging.info(f"\nTrade results successfully saved to: {filename}")
            return True
            
        except PermissionError:
            if attempt < max_attempts - 1:
                logging.warning(f"Unable to save to {filename}. Attempting alternate filename...")
                sleep(1)
            else:
                logging.error(f"Failed to save trade results after {max_attempts} attempts.")
                return False
        except Exception as e:
            logging.error(f"Error saving trade results: {str(e)}")
            return False

def save_trading_summary(trades_df, dates_to_process, daily_account_sizes, daily_pnl_list, rsi_stats):
    """
    Save comprehensive trading summary to Excel with proper error handling
    """
    try:
        summary_file = os.path.join(current_dir, 'trading_summary.xlsx')
        
        # Convert timezone-aware columns to timezone-naive
        excel_df = trades_df.copy()
        
        datetime_columns = [
            'date', 'entry_time', 'exit_time', 'exit_time1', 'exit_time2', 
            'stop_loss_hit_time', 'halt_start_time', 'recovery_date'
        ]
        
        for col in datetime_columns:
            if col in excel_df.columns:
                try:
                    if not excel_df[col].empty:
                        if not pd.api.types.is_datetime64_any_dtype(excel_df[col]):
                            excel_df[col] = pd.to_datetime(excel_df[col], errors='coerce')
                        
                        if pd.api.types.is_datetime64tz_dtype(excel_df[col]):
                            excel_df[col] = excel_df[col].dt.tz_localize(None)
                        
                        if hasattr(excel_df[col].dtype, 'tz') and excel_df[col].dtype.tz is not None:
                            excel_df[col] = excel_df[col].dt.tz_convert(None)
                            
                except Exception as e:
                    logging.warning(f"Could not process datetime column {col}: {e}")
                    try:
                        excel_df[col] = excel_df[col].astype(str)
                    except:
                        pass
        
        # Additional safety check
        for col in excel_df.columns:
            if pd.api.types.is_datetime64tz_dtype(excel_df[col]):
                try:
                    excel_df[col] = excel_df[col].dt.tz_localize(None)
                    logging.info(f"Fixed timezone issue in column: {col}")
                except Exception as e:
                    logging.warning(f"Could not fix timezone in column {col}: {e}")
                    excel_df[col] = excel_df[col].astype(str)
        
        with pd.ExcelWriter(summary_file, engine='openpyxl', mode='w') as writer:
            # Write main trades sheet
            excel_df.to_excel(writer, sheet_name='All Trades', index=False)
            
            # Write RSI analysis if available
            if not rsi_stats.empty:
                rsi_excel = rsi_stats.copy()
                for col in rsi_excel.columns:
                    if pd.api.types.is_datetime64tz_dtype(rsi_excel[col]):
                        try:
                            rsi_excel[col] = rsi_excel[col].dt.tz_localize(None)
                        except:
                            rsi_excel[col] = rsi_excel[col].astype(str)
                
                rsi_excel.to_excel(writer, sheet_name='RSI Analysis', index=False)
            
            # Daily summary
            daily_summary = pd.DataFrame({
                'Date': [d.date() if isinstance(d, pd.Timestamp) else d for d in dates_to_process],
                'Starting Balance': daily_account_sizes[:-1],
                'Ending Balance': daily_account_sizes[1:],
                'Daily P&L': [d['pnl'] for d in daily_pnl_list],
                'Number of Trades': [d['trades'] for d in daily_pnl_list]
            })

            if not rsi_stats.empty and 'rsi' in rsi_stats.columns:
                if len(rsi_stats) == len(dates_to_process):
                    daily_summary['RSI'] = rsi_stats['rsi'].values
                else:
                    daily_summary['RSI'] = None
            
            daily_summary.to_excel(writer, sheet_name='Daily Summary', index=False)
            
            # Strategy summary
            strategy_summary = trades_df.groupby('strategy').agg({
                'profit_loss': ['count', 'sum', 'mean', 'std'],
                'commission': 'sum'
            }).round(2)

            trailing_stop_stats = trades_df.groupby('strategy').agg({
                'trailing_stop_activated': ['count', 'sum'],
                'profit_loss': lambda x: x[trades_df['result1'] == 'Trailing Stop'].sum() if 'result1' in trades_df.columns else 0
            }).round(2)
            trailing_stop_stats.columns = ['Total Trades', 'Trailing Stops Activated', 'Trailing Stop P&L']
            
            strategy_summary.to_excel(writer, sheet_name='Strategy Summary')
            trailing_stop_stats.to_excel(writer, sheet_name='Trailing Stop Analysis')
            
            # Strategy win rates
            win_rates = []
            for strategy in ['Gapper', 'Backside']:
                strategy_trades = trades_df[trades_df['strategy'] == strategy]
                if not strategy_trades.empty:
                    total_trades = len(strategy_trades)
                    winning_trades = len(strategy_trades[strategy_trades['profit_loss'] > 0])
                    win_rate = winning_trades / total_trades
                    avg_win = strategy_trades[strategy_trades['profit_loss'] > 0]['profit_loss'].mean()
                    avg_loss = strategy_trades[strategy_trades['profit_loss'] < 0]['profit_loss'].mean()
                    total_pnl = strategy_trades['profit_loss'].sum()
                    
                    trailing_stop_trades = strategy_trades[strategy_trades['trailing_stop_activated'] == True]
                    trailing_stop_win_rate = (trailing_stop_trades['profit_loss'] > 0).mean() if not trailing_stop_trades.empty else 0
                    
                    win_rates.append({
                        'Strategy': strategy,
                        'Total Trades': total_trades,
                        'Winning Trades': winning_trades,
                        'Win Rate': win_rate,
                        'Average Win': avg_win,
                        'Average Loss': avg_loss,
                        'Total P&L': total_pnl,
                        'Trailing Stop Win Rate': trailing_stop_win_rate,
                        'Trailing Stop Trades': len(trailing_stop_trades)
                    })
            
            win_rates_df = pd.DataFrame(win_rates).round(4)
            win_rates_df.to_excel(writer, sheet_name='Strategy Win Rates', index=False)
        
        logging.info(f"Detailed summary saved to {summary_file}")
        return True
        
    except Exception as e:
        logging.error(f"Error saving Excel summary: {str(e)}")
        logging.error(traceback.format_exc())
        return False

def create_ticker_analysis_report(trades_df: pd.DataFrame) -> pd.DataFrame:
    """
    Create a detailed analysis report per ticker with overall and per-strategy metrics
    """
    unique_tickers = trades_df['ticker'].unique()
    analysis_results = []
    
    for ticker in unique_tickers:
        ticker_trades = trades_df[trades_df['ticker'] == ticker]
        
        total_trades = len(ticker_trades)
        total_pnl = ticker_trades['profit_loss'].sum()
        overall_win_rate = (ticker_trades['profit_loss'] > 0).mean()
        
        strategy_metrics = {}
        for strategy in ['Gapper', 'Backside', 'Intraday Backside']:
            strat_trades = ticker_trades[ticker_trades['strategy'] == strategy]
            if not strat_trades.empty:
                strategy_metrics[f'{strategy}_trades'] = len(strat_trades)
                strategy_metrics[f'{strategy}_pnl'] = strat_trades['profit_loss'].sum()
                strategy_metrics[f'{strategy}_win_rate'] = (strat_trades['profit_loss'] > 0).mean()
            else:
                strategy_metrics[f'{strategy}_trades'] = 0
                strategy_metrics[f'{strategy}_pnl'] = 0.0
                strategy_metrics[f'{strategy}_win_rate'] = 0.0
        
        analysis_results.append({
            'ticker': ticker,
            'total_trades': total_trades,
            'total_pnl': total_pnl,
            'overall_win_rate': overall_win_rate,
            **strategy_metrics
        })
    
    analysis_df = pd.DataFrame(analysis_results)
    analysis_df.to_csv(os.path.join(current_dir, 'ticker_analysis.csv'), index=False)
    return analysis_df

# ============================================================================
# MAIN EXECUTION BLOCK
# ============================================================================

if __name__ == "__main__":
    try:
        # Set up random seed for reproducibility
        random.seed(42)
        np.random.seed(42)

        # Set up logging
        root_logger = logging.getLogger('')
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
            
        logging.basicConfig(level=logging.INFO, 
                          format='%(asctime)s - %(levelname)s - %(message)s',
                          filename='backtesting_log.txt', 
                          filemode='w')
        console = logging.StreamHandler()
        console.setLevel(logging.INFO)
        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        console.setFormatter(formatter)
        logging.getLogger('').addHandler(console)

        # Initialize caching system
        cache_stats = initialize_caching_system()
        logging.info(f"Cache system initialized with {cache_stats['total_count']} files ({cache_stats['size_mb']:.2f} MB)")

        # Parse and validate dates (using CLI args now)
        try:
            start_date = pd.to_datetime(START_DATE)
            end_date = pd.to_datetime(END_DATE)
            logging.info(f"Running backtest for date range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
            candidates_dict = fetch_candidates_for_date_range(start_date, end_date, POLYGON_API_KEY)
                
        except ValueError as e:
            logging.error(f"Invalid date format: {str(e)}")
            raise

        # Convert candidates to DataFrames
        strategy_dfs = convert_candidates_to_dataframe(candidates_dict)
        for key in strategy_dfs:
            if 'Date' in strategy_dfs[key].columns:
                strategy_dfs[key]['Date'] = pd.to_datetime(strategy_dfs[key]['Date'])

        # Initialize tracking variables
        all_trades = []
        current_account_size = initial_account_size
        daily_account_sizes = [initial_account_size]
        winning_trade_count = 0
        daily_pnl_list = []

        # Process trades
        dates_to_process = pd.date_range(start=start_date, end=end_date, freq='B')

        trading_start_time = datetime.now()
        
        logging.info(f"\n{'='*80}")
        logging.info("STARTING MAIN TRADING LOOP")
        logging.info(f"{'='*80}")
        logging.info(f"Processing {len(dates_to_process)} trading days")
        logging.info(f"Initial account size: ${initial_account_size:,.2f}")

        for day_index, date in enumerate(tqdm(dates_to_process, desc="Processing trading days")):
            try:
                day_start_time = datetime.now()
                
                daily_trades, winning_trade_count = process_day_trades(
                    date, pd.DataFrame(), strategy_dfs['gap'], strategy_dfs['backside'],
                    current_account_size, winning_trade_count
                )
                
                day_processing_time = (datetime.now() - day_start_time).total_seconds()
                
                if daily_trades:
                    all_trades.extend(daily_trades)
                    total_daily_pnl = sum(trade['profit_loss'] for trade in daily_trades)
                    current_account_size += total_daily_pnl
                    daily_account_sizes.append(current_account_size)
                    
                    daily_pnl_list.append({
                        'date': pd.to_datetime(date),
                        'pnl': total_daily_pnl,
                        'trades': len(daily_trades)
                    })
                    
                    if output_format == 'text':
                        logging.info(f"\nTrades for {date.strftime('%Y-%m-%d')} (Day {day_index + 1}/{len(dates_to_process)}):")
                        logging.info(f"Daily P&L: ${total_daily_pnl:.2f}")
                        logging.info(f"Number of trades: {len(daily_trades)}")
                        logging.info(f"Account Balance: ${current_account_size:.2f}")
                        logging.info(f"Processing time: {day_processing_time:.1f} seconds")
                        
                        for trade in daily_trades:
                            pnl_indicator = "💰" if trade['profit_loss'] > 0 else "📉"
                            logging.info(f"  {pnl_indicator} {trade['strategy']}: {trade['ticker']} = ${trade['profit_loss']:.2f}")
                        
                else:
                    daily_pnl_list.append({
                        'date': pd.to_datetime(date),
                        'pnl': 0,
                        'trades': 0
                    })
                    daily_account_sizes.append(current_account_size)

                if (day_index + 1) % 10 == 0 and len(dates_to_process) > 20 and output_format == 'text':
                    elapsed_time = (datetime.now() - trading_start_time).total_seconds()
                    avg_time_per_day = elapsed_time / (day_index + 1)
                    remaining_days = len(dates_to_process) - (day_index + 1)
                    estimated_remaining_time = remaining_days * avg_time_per_day
                    
                    current_return = ((current_account_size / initial_account_size) - 1) * 100
                    
                    logging.info(f"\nProgress Update:")
                    logging.info(f"  Completed: {day_index + 1}/{len(dates_to_process)} days ({(day_index + 1)/len(dates_to_process)*100:.1f}%)")
                    logging.info(f"  Current return: {current_return:.2f}%")
                    logging.info(f"  Total trades so far: {len(all_trades)}")
                    logging.info(f"  Estimated time remaining: {estimated_remaining_time/60:.1f} minutes")

            except Exception as e:
                logging.error(f"Error processing trades for {date}: {str(e)}")
                logging.error(traceback.format_exc())
                continue

        trading_end_time = datetime.now()
        total_trading_time = (trading_end_time - trading_start_time).total_seconds()
        
        if output_format == 'text':
            logging.info(f"\n{'='*80}")
            logging.info("TRADING LOOP COMPLETE")
            logging.info(f"{'='*80}")
            logging.info(f"Total processing time: {total_trading_time:.1f} seconds ({total_trading_time/60:.1f} minutes)")
            logging.info(f"Total trades executed: {len(all_trades)}")

        # Convert trades to DataFrame and generate output
        if all_trades:
            try:
                trades_df = pd.DataFrame(all_trades)
                trades_df['date'] = pd.to_datetime(trades_df['date'])
                
                # Calculate daily return
                daily_return = calculate_daily_return(trades_df, initial_account_size)
                
                # Output results based on format
                if output_format == 'json':
                    output_json_results(trades_df, daily_return, initial_account_size)
                else:
                    # Generate full text output (existing functionality)
                    logging.info(f"\n{'='*60}")
                    logging.info("GENERATING PERFORMANCE REPORTS")
                    logging.info(f"{'='*60}")
                    
                    # Generate performance summary
                    daily_pnl = print_performance_summary(trades_df)
                    create_strategy_charts(trades_df)
                    
                    # Add RSI analysis
                    rsi_stats = analyze_equity_curve_rsi(trades_df)
                    
                    # Export results
                    if save_trade_results(trades_df, 'combined_trade_results_with_caching'):
                        logging.info("\nTrade results saved successfully")
                        
                        save_trading_summary(trades_df, dates_to_process, daily_account_sizes, daily_pnl_list, rsi_stats)
                        ticker_analysis_df = create_ticker_analysis_report(trades_df)
                        logging.info("Ticker analysis report generated and saved as 'ticker_analysis.csv'.")
                        
                    else:
                        logging.error("\nFailed to save trade results")
                    
                    # Final summary
                    final_account_value = current_account_size
                    total_return = ((final_account_value / initial_account_size) - 1) * 100
                    total_trades_executed = len(all_trades)
                    
                    logging.info(f"\n{'='*80}")
                    logging.info("BACKTEST COMPLETE - FINAL SUMMARY")
                    logging.info(f"{'='*80}")
                    logging.info(f"Performance Results:")
                    logging.info(f"  Initial Account: ${initial_account_size:,.2f}")
                    logging.info(f"  Final Account: ${final_account_value:,.2f}")
                    logging.info(f"  Total Return: {total_return:.2f}%")
                    logging.info(f"  Total Trades: {total_trades_executed}")
                    logging.info(f"  Trading Period: {dates_to_process[0].strftime('%Y-%m-%d')} to {dates_to_process[-1].strftime('%Y-%m-%d')}")
                    
            except Exception as e:
                logging.error(f"Error processing trade results: {str(e)}")
                logging.error(traceback.format_exc())
                if output_format == 'json':
                    print(json.dumps({'success': False, 'error': str(e)}))
        else:
            if output_format == 'json':
                output_json_results(pd.DataFrame(), 0.0, initial_account_size)
            else:
                logging.info("No trades were executed during the specified period")

    except Exception as e:
        logging.error(f"An error occurred during script execution: {str(e)}")
        logging.error(traceback.format_exc())
        if output_format == 'json':
            print(json.dumps({'success': False, 'error': str(e)}))

    if output_format == 'text':
        logging.info(f"\n{'='*80}")
        logging.info("BACKTEST COMPLETE")
        logging.info(f"{'='*80}")
        if all_trades:
            logging.info("All results saved. Check the generated files:")
            logging.info("  - combined_trade_results_with_caching.csv")
            logging.info("  - trading_summary.xlsx") 
            logging.info("  - ticker_analysis.csv")
            logging.info("  - Charts in trade_charts/ directory")
